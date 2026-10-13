'use client'

import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, colorFor, timeAgo } from '@/lib/client'
import { CommentHighlights, findQuote, selectedQuote, setCommentHighlights } from '@/lib/comment-highlights'
import { baseExtensions } from '@/lib/editor-schema'
import { can, ROLE_LABELS } from '@/lib/permissions'
import { realtimeEnabled, useDocumentChannel, type DocEvent } from '@/lib/realtime'
import type { CommentThread, DocumentDetail, PublicUser } from '@/lib/types'
import { AppHeader, Avatar } from './AppHeader'
import { CommentsPanel, type CommentActions } from './CommentsPanel'
import { ExportMenu } from './ExportMenu'
import { HistoryPanel } from './HistoryPanel'
import { ShareDialog } from './ShareDialog'
import { Toolbar } from './Toolbar'

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'
type Panel = 'comments' | 'history' | null

const AUTOSAVE_DELAY_MS = 800
const RETRY_DELAY_MS = 4000
const POLL_INTERVAL_MS = 5000
/** Typing pulses are sent at most this often, and a collaborator counts as "editing" for a bit longer. */
const ACTIVITY_THROTTLE_MS = 1500
const ACTIVITY_TTL_MS = 4000

// useEditor compares its options on every render and calls editor.setOptions() when they differ,
// which re-applies the view state and can clobber a DOM selection ProseMirror hasn't read yet
// (the cursor would jump to the start of the doc). Keep every option referentially stable.
const EDITOR_PROPS = { attributes: { class: 'prose', spellcheck: 'true' } }

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
  const [panel, setPanel] = useState<Panel>(null)
  const [threads, setThreads] = useState<CommentThread[] | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [draftQuote, setDraftQuote] = useState<string | null>(null)
  const [selectionText, setSelectionText] = useState('')
  const [activity, setActivity] = useState<Record<string, number>>({})

  // Save-loop state lives in refs so async callbacks always see the latest values.
  const versionRef = useRef(initial.version)
  const dirtyRef = useRef(false)
  const editCountRef = useRef(0)
  const savingRef = useRef(false)
  const conflictRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastActivitySentRef = useRef(0)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const activateCommentRef = useRef<(id: string) => void>(() => {})
  const editableRef = useRef(can(initial.role, 'edit'))

  const role = doc.role
  const editable = can(role, 'edit') && !accessLost
  editableRef.current = editable
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

  const loadComments = useCallback(async () => {
    try {
      setThreads((await api<{ comments: CommentThread[] }>(`/api/documents/${initial.id}/comments`)).comments)
    } catch {
      /* access loss is surfaced by refreshFromServer */
    }
  }, [initial.id])

  const onRemoteEvent = useCallback(
    (event: DocEvent) => {
      if (event.type === 'activity') {
        setActivity((a) => ({ ...a, [event.userId]: Date.now() }))
        return
      }
      if (event.type === 'comments') return void loadComments()
      if (event.type === 'saved' && event.version <= versionRef.current) return
      void refreshFromServer()
    },
    [refreshFromServer, loadComments],
  )

  const { peers, connected, broadcast } = useDocumentChannel(initial.id, me, onRemoteEvent)

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  // Without Supabase Realtime configured, fall back to light polling so changes still show up.
  useEffect(() => {
    if (realtimeEnabled) return
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshFromServer()
      void loadComments()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refreshFromServer, loadComments])

  // Expire "is editing" indicators.
  useEffect(() => {
    const id = setInterval(() => {
      setActivity((a) => {
        const now = Date.now()
        const live = Object.entries(a).filter(([, t]) => now - t < ACTIVITY_TTL_MS)
        return live.length === Object.keys(a).length ? a : Object.fromEntries(live)
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

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

  const extensions = useMemo(
    () => [
      ...baseExtensions,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      CommentHighlights.configure({ onActivate: activateCommentRef }),
    ],
    [],
  )
  const initialEditable = useRef(can(initial.role, 'edit')).current

  const editor = useEditor({
    extensions,
    content: initial.content,
    editable: initialEditable,
    immediatelyRender: false,
    editorProps: EDITOR_PROPS,
    onUpdate: () => {
      if (!editableRef.current) return // read-only roles never save, whatever plugins do to the view
      dirtyRef.current = true
      editCountRef.current++
      setStatus('unsaved')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
      if (Date.now() - lastActivitySentRef.current > ACTIVITY_THROTTLE_MS) {
        lastActivitySentRef.current = Date.now()
        broadcast({ type: 'activity', userId: user.id, name: user.name })
      }
    },
  })
  editorRef.current = editor

  useEffect(() => {
    editor?.setEditable(editable, false) // false: toggling editability is not a content change
  }, [editor, editable])

  // ---- Comments ---------------------------------------------------------------------

  activateCommentRef.current = (id: string) => {
    setActiveCommentId(id)
    setPanel('comments')
  }

  // Keep highlights in sync with the open threads and the active one.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const open = (threads ?? []).filter((t) => t.quote && !t.resolvedAt).map((t) => ({ id: t.id, quote: t.quote! }))
    setCommentHighlights(editor, panel === 'history' ? [] : open, activeCommentId)
  }, [editor, threads, activeCommentId, panel])

  // Track selected text (works for read-only editors too) to offer "comment on selection".
  useEffect(() => {
    if (!editor) return
    const update = () => setSelectionText(selectedQuote(editor))
    document.addEventListener('selectionchange', update)
    editor.on('selectionUpdate', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      editor.off('selectionUpdate', update)
    }
  }, [editor])

  const startComment = useCallback(() => {
    const quote = editorRef.current ? selectedQuote(editorRef.current) : ''
    setDraftQuote(quote || null)
    setActiveCommentId(null)
    setPanel('comments')
  }, [])

  const commentMutation = useCallback(
    async (request: Promise<{ comments: CommentThread[] }>) => {
      try {
        setThreads((await request).comments)
        broadcast({ type: 'comments', by: user.name })
        return true
      } catch (err) {
        flashNotice(err instanceof ApiError ? err.message : 'Could not update comments.')
        return false
      }
    },
    [broadcast, user.name, flashNotice],
  )

  const commentActions: CommentActions = useMemo(() => {
    const base = `/api/documents/${initial.id}/comments`
    return {
      add: (body, quote) => commentMutation(api(base, { method: 'POST', body: JSON.stringify({ body, quote }) })),
      reply: (parentId, body) => commentMutation(api(base, { method: 'POST', body: JSON.stringify({ body, parentId }) })),
      resolve: async (id, resolved) => {
        await commentMutation(api(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) }))
        if (resolved) setActiveCommentId(null)
      },
      remove: async (id) => {
        await commentMutation(api(`${base}/${id}`, { method: 'DELETE' }))
      },
    }
  }, [initial.id, commentMutation])

  const jumpToComment = (id: string) => {
    setActiveCommentId(id)
    document.querySelector(`[data-comment-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  // ---- Version history --------------------------------------------------------------

  async function restore(versionId: string) {
    if (dirtyRef.current && !confirm('You have unsaved changes. Restoring will discard them. Continue?')) return
    try {
      const { document: restored } = await api<{ document: DocumentDetail }>(
        `/api/documents/${initial.id}/versions/${versionId}/restore`,
        { method: 'POST' },
      )
      clearTimeout(timerRef.current)
      if (editor) applyRemoteContent(editor, restored.content)
      versionRef.current = restored.version
      dirtyRef.current = false
      conflictRef.current = false
      setConflict(null)
      setStatus('saved')
      setDoc((d) => ({ ...restored, content: d.content }))
      broadcast({ type: 'saved', version: restored.version, by: user.name })
      flashNotice('Version restored')
    } catch (err) {
      flashNotice(err instanceof ApiError ? err.message : 'Could not restore that version.')
    }
  }

  // ---- Keyboard shortcuts & lifecycle -----------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
      if (mod && e.altKey && e.key.toLowerCase() === 'm' && can(role, 'comment')) {
        e.preventDefault()
        startComment()
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
  }, [save, startComment, role])

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

  // ---- Render -----------------------------------------------------------------------

  const statusLabel = conflict
    ? 'Not saved: conflict'
    : { saved: 'All changes saved', unsaved: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed, retrying…' }[status]
  const editingNow = peers.filter((p) => activity[p.id])
  const openThreads = threads?.filter((t) => !t.resolvedAt).length ?? 0
  const firstNode = editor?.state.doc.firstChild
  const printTitle = !(firstNode?.type.name === 'heading' && firstNode.textContent === doc.title)

  return (
    <>
      <AppHeader user={user}>
        <div className="presence" aria-label="People in this document">
          {peers.map((p) => (
            <span key={p.id} className={`presence-avatar${activity[p.id] ? ' is-editing' : ''}`} style={{ color: p.color }}>
              <Avatar user={p} size={28} title={`${p.name} is ${activity[p.id] ? 'editing' : 'viewing'}`} />
            </span>
          ))}
          {realtimeEnabled && (
            <span className={`live-dot${connected ? ' is-on' : ''}`} title={connected ? 'Live' : 'Connecting…'} />
          )}
          <span className="muted small presence-label" aria-live="polite">
            {editingNow.length > 0
              ? `${editingNow.map((p) => p.name.split(' ')[0]).join(', ')} ${editingNow.length > 1 ? 'are' : 'is'} editing…`
              : peers.length > 0
                ? `${peers.length} other${peers.length > 1 ? 's' : ''} here`
                : null}
          </span>
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
          {role !== 'owner' && (
            <span className={`badge badge-${role}`} title={`Shared by ${doc.owner.name}`}>
              {ROLE_LABELS[role].label}
            </span>
          )}
          <button
            className={`btn btn-sm${panel === 'comments' ? ' is-on' : ''}`}
            onClick={() => setPanel((p) => (p === 'comments' ? null : 'comments'))}
            aria-pressed={panel === 'comments'}
          >
            💬 Comments{openThreads > 0 && <span className="count">{openThreads}</span>}
          </button>
          <button
            className={`btn btn-sm${panel === 'history' ? ' is-on' : ''}`}
            onClick={() => setPanel((p) => (p === 'history' ? null : 'history'))}
            aria-pressed={panel === 'history'}
          >
            🕘 History
          </button>
          <ExportMenu docId={initial.id} title={doc.title} />
          <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
            Share
          </button>
        </div>
      </div>

      {editor && (
        <Toolbar
          editor={editor}
          disabled={!editable}
          canComment={can(role, 'comment') && !accessLost}
          hasSelection={selectionText.length > 0}
          onComment={startComment}
        />
      )}

      {accessLost && (
        <div className="banner banner-error" role="alert">
          You no longer have access to this document. <Link href="/">Back to documents</Link>
        </div>
      )}
      {!accessLost && role === 'viewer' && (
        <div className="banner">You have view-only access. Ask {doc.owner.name} if you need to comment or edit.</div>
      )}
      {!accessLost && role === 'commenter' && (
        <div className="banner">
          You can comment but not edit. Select text and press <strong>💬 Comment</strong>.
        </div>
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

      <div className={`doc-layout${panel ? ' has-panel' : ''}`}>
        <main className="page-wrap" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
          <article className="page">
            {printTitle && <h1 className="print-title">{doc.title}</h1>}
            <EditorContent editor={editor} />
          </article>
        </main>

        {panel === 'comments' && (
          <CommentsPanel
            threads={threads}
            me={user}
            role={role}
            draftQuote={draftQuote}
            selectionQuote={selectionText}
            activeId={activeCommentId}
            isAnchored={(quote) => (editor ? findQuote(editor.state.doc, quote) !== null : true)}
            actions={commentActions}
            onDraftQuote={setDraftQuote}
            onActivate={jumpToComment}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'history' && (
          <HistoryPanel
            docId={initial.id}
            currentVersion={doc.version}
            canRestore={editable}
            onRestore={restore}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

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
