'use client'

import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/client'
import type { DocumentDetail, PublicUser, Share, ShareRole } from '@/lib/types'
import { Avatar } from './AppHeader'

export function ShareDialog({
  doc,
  onClose,
  onChanged,
}: {
  doc: DocumentDetail
  onClose: () => void
  onChanged: () => void
}) {
  const isOwner = doc.role === 'owner'
  const [shares, setShares] = useState<Share[] | null>(null)
  const [directory, setDirectory] = useState<PublicUser[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('editor')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ shares: Share[] }>(`/api/documents/${doc.id}/shares`)
      .then((r) => setShares(r.shares))
      .catch((e) => setError(e.message))
    if (isOwner) api<{ users: PublicUser[] }>('/api/users').then((r) => setDirectory(r.users), () => {})
  }, [doc.id, isOwner])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function mutate(request: Promise<{ shares: Share[] }>) {
    setBusy(true)
    setError(null)
    try {
      setShares((await request).shares)
      onChanged()
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const ok = await mutate(
      api(`/api/documents/${doc.id}/shares`, { method: 'POST', body: JSON.stringify({ email, role }) }),
    )
    if (ok) setEmail('')
  }

  const changeRole = (userEmail: string, newRole: ShareRole) =>
    mutate(api(`/api/documents/${doc.id}/shares`, { method: 'POST', body: JSON.stringify({ email: userEmail, role: newRole }) }))
  const revoke = (userId: string) => mutate(api(`/api/documents/${doc.id}/shares/${userId}`, { method: 'DELETE' }))

  const sharedIds = new Set(shares?.map((s) => s.user.id))
  const suggestions = directory.filter((u) => !sharedIds.has(u.id))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="modal-head">
          <h2 id="share-title">Share “{doc.title}”</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {isOwner ? (
          <form className="share-form" onSubmit={add}>
            <input
              type="email"
              placeholder="Add people by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              list="share-directory"
              required
              autoFocus
            />
            <datalist id="share-directory">
              {suggestions.map((u) => (
                <option key={u.id} value={u.email}>
                  {u.name}
                </option>
              ))}
            </datalist>
            <select value={role} onChange={(e) => setRole(e.target.value as ShareRole)} aria-label="Permission">
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button className="btn btn-primary" disabled={busy}>
              Share
            </button>
          </form>
        ) : (
          <p className="muted small">Only the owner can change who has access.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <h3 className="share-subhead">People with access</h3>
        <ul className="share-list">
          <li>
            <Avatar user={doc.owner} />
            <span className="share-who">
              <span>{doc.owner.name}</span>
              <span className="muted small">{doc.owner.email}</span>
            </span>
            <span className="muted small">Owner</span>
          </li>
          {shares === null && <li className="muted small">Loading…</li>}
          {shares?.map((s) => (
            <li key={s.user.id}>
              <Avatar user={s.user} />
              <span className="share-who">
                <span>{s.user.name}</span>
                <span className="muted small">{s.user.email}</span>
              </span>
              {isOwner ? (
                <span className="share-actions">
                  <select
                    value={s.role}
                    disabled={busy}
                    onChange={(e) => changeRole(s.user.email, e.target.value as ShareRole)}
                    aria-label={`Permission for ${s.user.name}`}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => revoke(s.user.id)}>
                    Remove
                  </button>
                </span>
              ) : (
                <span className="muted small">{s.role === 'editor' ? 'Can edit' : 'Can view'}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
