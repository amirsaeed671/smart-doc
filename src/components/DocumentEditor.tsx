'use client'

import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, colorFor, timeAgo } from '@/lib/client'
import { baseExtensions } from '@/lib/editor-schema'
import { realtimeEnabled, useDocumentChannel, type DocEvent } from '@/lib/realtime'
import type { DocumentDetail, PublicUser } from '@/lib/types'
import { AppHeader, Avatar } from './AppHeader'
import { ShareDialog } from './ShareDialog'
import { Toolbar } from './Toolbar'

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

const AUTOSAVE_DELAY_MS = 800
const RETRY_DELAY_MS = 4000
const POLL_INTERVAL_MS = 5000

const canEditRole = (role: DocumentDetail['role']) => role === 'owner' || role === 'editor'

/** Replace editor content with a remote version, keeping the cursor roughly where it was. */
function applyRemoteContent(editor: Editor, content: DocumentDetail['content']) {
  const { from, to } = editor.state.selection
  editor.commands.setContent(content, { emitUpdate: false })
  const max = editor.state.doc.content.size
  editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
}

export function DocumentEditor({ user, initial }: { user: PublicUser; initial: DocumentDetail }) {
  const [doc, setDoc] = useState(initial)
  const [title, setTitle] = useState(initial.title)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<DocumentDetail | null>(null)
  const [accessLost, setAccessLost] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  // Save-loop state lives in refs so async callbacks always see the latest values.
  const versionRef = useRef(initial.version)
  const dirtyRef = useRef(false)
  const editCountRef = useRef(0)
  const savingRef = useRef(false)
  const conflictRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)

  const editable = canEditRole(doc.role) && !accessLost
  const me = useMemo(() => ({ ...user, color: colorFor(user.id) }), [user])

  const flashNotice = useCallback((message: string) => {
    setNotice(message)
    setTimeout(() => setNotice((n) => (n === message ? null : n)), 3500)
  }, [])

  // ---- Remote changes ---------------------------------------------------------------

  const refreshFromServer = useCallback(async () => {
    const editor = editorRef.current
    if (!editor || savingRef.current) return
    let latest: DocumentDetail
    try {
      latest = (await api<{ document: DocumentDetail }>(`/api/documents/${initial.id}`)).document
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setAccessLost(true)
      return
    }
    setDoc((d) => ({ ...latest, content: d.content }))
    if (document.activeElement !== titleInputRef.current) setTitle(latest.title)
    if (latest.version <= versionRef.current) return

    if (dirtyRef.current) {
      // Someone saved while we have unsaved edits; ask rather than guess.
      conflictRef.current = true
      setConflict(latest)
    } else {
      applyRemoteContent(editor, latest.content)
      versionRef.current = latest.version
      if (latest.updatedByName && latest.updatedByName !== user.name) flashNotice(`Updated by ${latest.updatedByName}`)
    }
  }, [initial.id, user.name, flashNotice])

  const onRemoteEvent = useCallback(
    (event: DocEvent) => {
      if (event.type === 'saved' && event.version <= versionRef.current) return
      void refreshFromServer()
    },
    [refreshFromServer],
  )

  const { peers, connected, broadcast } = useDocumentChannel(initial.id, me, onRemoteEvent)

  // Without Supabase Realtime configured, fall back to light polling so changes still show up.
  useEffect(() => {
    if (realtimeEnabled) return
    const id = setInterval(() => document.visibilityState === 'visible' && void refreshFromServer(), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refreshFromServer])

  // ---- Saving -----------------------------------------------------------------------

  const save = useCallback(async () => {
    const editor = editorRef.current
    clearTimeout(timerRef.current)
    if (!editor || !dirtyRef.current || savingRef.current || conflictRef.current) return
    savingRef.current = true
    const editCountAtStart = editCountRef.current
    setStatus('saving')
    try {
      const { document: saved } = await api<{ document: DocumentDetail }>(`/api/documents/${initial.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: editor.getJSON(), baseVersion: versionRef.current }),
      })
      versionRef.current = saved.version
      setDoc((d) => ({ ...d, version: saved.version, updatedAt: saved.updatedAt, updatedByName: saved.updatedByName }))
      broadcast({ type: 'saved', version: saved.version, by: user.name })
      if (editCountRef.current === editCountAtStart) {
        dirtyRef.current = false
        setStatus('saved')
      } else {
        setStatus('unsaved') // typed during the request; save again shortly
        timerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        conflictRef.current = true
        setConflict((err.details as { latest: DocumentDetail }).latest)
        setStatus('unsaved')
      } else if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setStatus('error')
        savingRef.current = false
        await refreshFromServer() // role downgraded or access revoked
        if (err.status === 404) setAccessLost(true)
        return
      } else {
        setStatus('error')
        timerRef.current = setTimeout(() => void save(), RETRY_DELAY_MS)
      }
    } finally {
      savingRef.current = false
    }
  }, [initial.id, broadcast, user.name, refreshFromServer])

  const editor = useEditor({
    extensions: [...baseExtensions, Placeholder.configure({ placeholder: 'Start writing…' })],
    content: initial.content,
    editable: canEditRole(initial.role),
    immediatelyRender: false,
    editorProps: { attributes: { class: 'prose', spellcheck: 'true' } },
    onUpdate: () => {
      dirtyRef.current = true
      editCountRef.current++
      setStatus('unsaved')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
    },
  })
  editorRef.current = editor

  useEffect(() => {
    editor?.setEditable(editable, false) // false: toggling editability is not a content change
  }, [editor, editable])

  // Ctrl/Cmd+S saves immediately; warn before leaving with unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [save])

  // Freshly created documents: put the cursor in the title so naming is the first step.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new')) {
      titleInputRef.current?.select()
      window.history.replaceState(null, '', `/docs/${initial.id}`)
    }
  }, [initial.id])

  // ---- Conflict resolution ----------------------------------------------------------

  function loadTheirs() {
    if (!editor || !conflict) return
    applyRemoteContent(editor, conflict.content)
    versionRef.current = conflict.version
    dirtyRef.current = false
    conflictRef.current = false
    setConflict(null)
    setStatus('saved')
  }

  function keepMine() {
    if (!conflict) return
    versionRef.current = conflict.version // rebase onto latest, then overwrite with our content
    conflictRef.current = false
    setConflict(null)
    void save()
  }

  // ---- Title ------------------------------------------------------------------------

  async function commitTitle() {
    const next = title.trim() || 'Untitled document'
    if (next === doc.title) {
      setTitle(next)
      return
    }
    try {
      const { document: saved } = await api<{ document: DocumentDetail }>(`/api/documents/${initial.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: next }),
      })
      setDoc((d) => ({ ...d, title: saved.title }))
      setTitle(saved.title)
      broadcast({ type: 'title', title: saved.title, by: user.name })
    } catch (err) {
      setTitle(doc.title)
      flashNotice(err instanceof ApiError ? err.message : 'Could not rename document.')
    }
  }

  useEffect(() => {
    document.title = `${doc.title} · Smart Doc`
  }, [doc.title])

  const statusLabel = conflict
    ? 'Not saved: conflict'
    : { saved: 'All changes saved', unsaved: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed, retrying…' }[status]

  return (
    <>
      <AppHeader user={user}>
        <div className="presence" aria-label="People viewing this document">
          {peers.map((p) => (
            <Avatar key={p.id} user={p} size={28} title={`${p.name} is viewing`} />
          ))}
          {realtimeEnabled ? (
            <span className={`live-dot${connected ? ' is-on' : ''}`} title={connected ? 'Live' : 'Connecting…'} />
          ) : null}
          {peers.length > 0 && <span className="muted small">{peers.length} other{peers.length > 1 ? 's' : ''} here</span>}
        </div>
      </AppHeader>

      <div className="doc-bar">
        <div className="doc-bar-left">
          <Link href="/" className="btn btn-ghost btn-sm" aria-label="Back to documents">
            ←
          </Link>
          <input
            ref={titleInputRef}
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                // view.focus() is synchronous (commands.focus waits a frame), so no keystroke lands in the title.
                editor?.view.focus()
                editor?.commands.setTextSelection(1)
              }
              if (e.key === 'Escape') {
                setTitle(doc.title)
                e.currentTarget.blur()
              }
            }}
            readOnly={!editable}
            maxLength={200}
            aria-label="Document title"
          />
          <span className={`save-status status-${conflict ? 'error' : status}`} role="status">
            {editable ? statusLabel : null}
          </span>
        </div>
        <div className="doc-bar-right">
          <span className="muted small hide-sm" title={new Date(doc.updatedAt).toLocaleString()}>
            Edited {timeAgo(doc.updatedAt)}
            {doc.updatedByName ? ` by ${doc.updatedByName}` : ''}
          </span>
          {doc.role !== 'owner' && (
            <span className={`badge badge-${doc.role}`}>
              {doc.role === 'editor' ? `Shared by ${doc.owner.name}` : 'View only'}
            </span>
          )}
          <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
            Share
          </button>
        </div>
      </div>

      {editor && <Toolbar editor={editor} disabled={!editable} />}

      {accessLost && (
        <div className="banner banner-error" role="alert">
          You no longer have access to this document. <Link href="/">Back to documents</Link>
        </div>
      )}
      {!accessLost && doc.role === 'viewer' && (
        <div className="banner">You have view-only access. Ask {doc.owner.name} for edit access.</div>
      )}
      {conflict && (
        <div className="banner banner-warn" role="alert">
          <span>
            <strong>{conflict.updatedByName ?? 'Someone'}</strong> saved a newer version while you were editing. Your recent
            changes are not saved yet.
          </span>
          <span className="banner-actions">
            <button className="btn btn-sm" onClick={loadTheirs}>
              Discard mine, load theirs
            </button>
            <button className="btn btn-sm btn-primary" onClick={keepMine}>
              Keep mine (overwrite)
            </button>
          </span>
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}

      <main className="page-wrap" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <article className="page">
          <EditorContent editor={editor} />
        </article>
      </main>

      {shareOpen && (
        <ShareDialog
          doc={doc}
          onClose={() => setShareOpen(false)}
          onChanged={() => broadcast({ type: 'access', by: user.name })}
        />
      )}
    </>
  )
}
