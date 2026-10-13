'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { api, ApiError, timeAgo } from '@/lib/client'
import { ROLE_LABELS } from '@/lib/permissions'
import type { DocumentDetail, DocumentSummary, PublicUser } from '@/lib/types'
import { AppHeader, Avatar } from './AppHeader'

type Lists = { owned: DocumentSummary[]; shared: DocumentSummary[] }

const ACCEPT = '.txt,.md,.markdown,.docx'

export function Dashboard({ user, initial }: { user: PublicUser; initial: Lists }) {
  const router = useRouter()
  const [lists, setLists] = useState(initial)
  const [busy, setBusy] = useState<null | 'create' | 'upload'>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function createDoc() {
    setBusy('create')
    setError(null)
    try {
      const { document } = await api<{ document: DocumentDetail }>('/api/documents', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      router.push(`/docs/${document.id}?new=1`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create document.')
      setBusy(null)
    }
  }

  async function upload(file: File) {
    setBusy('upload')
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const { document } = await api<{ document: DocumentDetail }>('/api/documents/import', { method: 'POST', body: form })
      router.push(`/docs/${document.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.')
      setBusy(null)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function remove(doc: DocumentSummary) {
    if (!confirm(`Delete "${doc.title}"? This can't be undone and removes access for everyone it's shared with.`)) return
    try {
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' })
      setLists((l) => ({ ...l, owned: l.owned.filter((d) => d.id !== doc.id) }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete document.')
    }
  }

  return (
    <>
      <AppHeader user={user} />
      <main className="dashboard">
        <section className="dashboard-actions">
          <div>
            <h1>Documents</h1>
            <p className="muted">Create a document, or import one from a file.</p>
          </div>
          <div className="action-buttons">
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              {busy === 'upload' ? 'Importing…' : 'Import file'}
            </button>
            <button className="btn btn-primary" onClick={createDoc} disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : '+ New document'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </div>
        </section>
        <p className="muted small upload-hint">
          Import supports <strong>.txt</strong>, <strong>.md</strong> and <strong>.docx</strong> (up to 2 MB). The file
          becomes a new editable document; headings, lists, bold/italic and links are kept.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <DocList
          title="My documents"
          empty="You don't own any documents yet. Create one to get started."
          docs={lists.owned}
          onDelete={remove}
        />
        <DocList
          title="Shared with me"
          empty="Nothing has been shared with you yet."
          docs={lists.shared}
          showOwner
        />
      </main>
    </>
  )
}

function DocList({
  title,
  empty,
  docs,
  showOwner,
  onDelete,
}: {
  title: string
  empty: string
  docs: DocumentSummary[]
  showOwner?: boolean
  onDelete?: (d: DocumentSummary) => void
}) {
  return (
    <section className="doc-section">
      <h2>
        {title} <span className="count">{docs.length}</span>
      </h2>
      {docs.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="doc-row">
              <Link href={`/docs/${d.id}`} className="doc-link">
                <span className="doc-icon" aria-hidden>
                  ▤
                </span>
                <span className="doc-main">
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-preview">{d.preview || 'Empty document'}</span>
                </span>
              </Link>
              <span className="doc-meta">
                {showOwner && (
                  <span className="doc-owner">
                    <Avatar user={d.owner} size={22} /> {d.owner.name}
                  </span>
                )}
                {d.role !== 'owner' && <span className={`badge badge-${d.role}`}>{ROLE_LABELS[d.role].label}</span>}
                <span className="muted small" title={new Date(d.updatedAt).toLocaleString()}>
                  {timeAgo(d.updatedAt)}
                  {d.updatedByName ? ` · ${d.updatedByName}` : ''}
                </span>
                {onDelete && (
                  <button className="btn btn-ghost btn-sm" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>
                    Delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
