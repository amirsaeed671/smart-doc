'use client'

import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError, timeAgo } from '@/lib/client'
import { baseExtensions } from '@/lib/editor-schema'
import type { VersionDetail, VersionSummary } from '@/lib/types'

const PREVIEW_PROPS = { attributes: { class: 'prose' } } // stable, so useEditor doesn't reset options each render

export function HistoryPanel({
  docId,
  currentVersion,
  canRestore,
  onRestore,
  onClose,
}: {
  docId: string
  /** Changes whenever the document is saved, so the list stays fresh while open. */
  currentVersion: number
  canRestore: boolean
  onRestore: (versionId: string) => Promise<void>
  onClose: () => void
}) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<VersionDetail | null>(null)

  useEffect(() => {
    api<{ versions: VersionSummary[] }>(`/api/documents/${docId}/versions`)
      .then((r) => setVersions(r.versions))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load history.'))
  }, [docId, currentVersion])

  async function open(v: VersionSummary) {
    try {
      setPreview((await api<{ version: VersionDetail }>(`/api/documents/${docId}/versions/${v.id}`)).version)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load that version.')
    }
  }

  return (
    <aside className="side-panel" aria-label="Version history">
      <div className="side-head">
        <h2>Version history</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close history">
          ✕
        </button>
      </div>
      <p className="muted small side-note">
        Saves are grouped into editing sessions (one person, within 10 minutes). Restoring adds a new version, so nothing is lost.
      </p>
      {error && <p className="error side-note">{error}</p>}
      {versions === null && !error && <p className="muted small side-note">Loading…</p>}
      <ol className="versions">
        {versions?.map((v, i) => (
          <li key={v.id}>
            <button className="version-row" onClick={() => open(v)}>
              <span className="version-when" title={new Date(v.updatedAt).toLocaleString()}>
                {new Date(v.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {i === 0 && <span className="badge">Current</span>}
              </span>
              <span className="muted small">
                {v.authorName ?? 'Unknown'} · {timeAgo(v.updatedAt)}
              </span>
              {v.label && <span className="version-label">{v.label}</span>}
            </button>
          </li>
        ))}
      </ol>

      {preview && (
        <VersionPreview
          version={preview}
          isCurrent={versions?.[0]?.id === preview.id}
          canRestore={canRestore}
          onRestore={async () => {
            await onRestore(preview.id)
            setPreview(null)
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </aside>
  )
}

function VersionPreview({
  version,
  isCurrent,
  canRestore,
  onRestore,
  onClose,
}: {
  version: VersionDetail
  isCurrent: boolean
  canRestore: boolean
  onRestore: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  // A read-only editor renders the snapshot through the same schema (no raw HTML injection).
  const editor = useEditor({
    extensions: baseExtensions,
    content: version.content,
    editable: false,
    immediatelyRender: false,
    editorProps: PREVIEW_PROPS,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal: the side panel is sticky (its own stacking context), which would trap the modal under the toolbar.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Version preview">
        <div className="modal-head">
          <div>
            <h2>{version.title}</h2>
            <p className="muted small">
              {new Date(version.updatedAt).toLocaleString()} · {version.authorName ?? 'Unknown'}
              {version.label ? ` · ${version.label}` : ''}
            </p>
          </div>
          <div className="modal-head-actions">
            {canRestore && !isCurrent && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await onRestore().finally(() => setBusy(false))
                }}
              >
                {busy ? 'Restoring…' : 'Restore this version'}
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} aria-label="Close preview">
              ✕
            </button>
          </div>
        </div>
        <div className="version-preview">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
