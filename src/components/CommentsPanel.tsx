'use client'

import { useEffect, useRef, useState } from 'react'
import { timeAgo } from '@/lib/client'
import { can } from '@/lib/permissions'
import type { CommentThread, PublicUser, Role } from '@/lib/types'
import { Avatar } from './AppHeader'

export interface CommentActions {
  add: (body: string, quote: string | null) => Promise<boolean>
  reply: (threadId: string, body: string) => Promise<boolean>
  resolve: (threadId: string, resolved: boolean) => Promise<void>
  remove: (commentId: string) => Promise<void>
}

export function CommentsPanel({
  threads,
  me,
  role,
  draftQuote,
  selectionQuote,
  activeId,
  isAnchored,
  actions,
  onDraftQuote,
  onActivate,
  onClose,
}: {
  threads: CommentThread[] | null
  me: PublicUser
  role: Role
  /** Quote captured for the comment being written (null = general comment). */
  draftQuote: string | null
  /** Text currently selected in the editor, offered as a quote. */
  selectionQuote: string
  activeId: string | null
  isAnchored: (quote: string) => boolean
  actions: CommentActions
  onDraftQuote: (quote: string | null) => void
  onActivate: (id: string) => void
  onClose: () => void
}) {
  const [showResolved, setShowResolved] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const canComment = can(role, 'comment')

  useEffect(() => {
    if (draftQuote) composerRef.current?.focus()
  }, [draftQuote])

  useEffect(() => {
    if (activeId) document.getElementById(`thread-${activeId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  const open = threads?.filter((t) => !t.resolvedAt) ?? []
  const resolved = threads?.filter((t) => t.resolvedAt) ?? []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    setBusy(true)
    if (await actions.add(draft, draftQuote)) {
      setDraft('')
      onDraftQuote(null)
    }
    setBusy(false)
  }

  return (
    <aside className="side-panel" aria-label="Comments">
      <div className="side-head">
        <h2>Comments</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close comments">
          ✕
        </button>
      </div>

      {canComment ? (
        <form className="composer" onSubmit={submit}>
          {draftQuote ? (
            <blockquote className="quote">
              {draftQuote}
              <button type="button" className="link-btn" onClick={() => onDraftQuote(null)}>
                remove
              </button>
            </blockquote>
          ) : selectionQuote ? (
            <button
              type="button"
              className="link-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onDraftQuote(selectionQuote)}
            >
              + Comment on selected text
            </button>
          ) : (
            <p className="muted small">Select text in the document to comment on it, or leave a general comment.</p>
          )}
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={draftQuote ? 'Comment on this text…' : 'Add a comment…'}
            rows={draft ? 3 : 2}
            maxLength={2000}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit(e)}
          />
          {draft.trim() && (
            <div className="composer-actions">
              <span className="muted small">Ctrl+Enter to post</span>
              <button className="btn btn-primary btn-sm" disabled={busy}>
                Comment
              </button>
            </div>
          )}
        </form>
      ) : (
        <p className="muted small side-note">You have view-only access, so you can read comments but not add them.</p>
      )}

      {threads === null && <p className="muted small side-note">Loading…</p>}
      {threads?.length === 0 && <p className="muted small side-note">No comments yet.</p>}

      <div className="threads">
        {open.map((t) => (
          <Thread
            key={t.id}
            thread={t}
            me={me}
            role={role}
            active={t.id === activeId}
            anchored={!t.quote || isAnchored(t.quote)}
            actions={actions}
            onActivate={onActivate}
          />
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="resolved-section">
          <button className="link-btn" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
          {showResolved &&
            resolved.map((t) => (
              <Thread
                key={t.id}
                thread={t}
                me={me}
                role={role}
                active={false}
                anchored
                actions={actions}
                onActivate={onActivate}
              />
            ))}
        </div>
      )}
    </aside>
  )
}

function Thread({
  thread,
  me,
  role,
  active,
  anchored,
  actions,
  onActivate,
}: {
  thread: CommentThread
  me: PublicUser
  role: Role
  active: boolean
  anchored: boolean
  actions: CommentActions
  onActivate: (id: string) => void
}) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const isResolved = Boolean(thread.resolvedAt)
  const canResolve = can(role, 'edit') || thread.author.id === me.id
  const canDelete = (authorId: string) => authorId === me.id || can(role, 'manage')

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return
    setBusy(true)
    if (await actions.reply(thread.id, reply)) setReply('')
    setBusy(false)
  }

  return (
    <article
      id={`thread-${thread.id}`}
      className={`thread${active ? ' is-active' : ''}${isResolved ? ' is-resolved' : ''}`}
      onClick={() => !isResolved && onActivate(thread.id)}
    >
      {thread.quote && (
        <blockquote className={`quote${anchored ? '' : ' is-orphan'}`} title={anchored ? undefined : 'The quoted text was changed or removed'}>
          {thread.quote}
          {!anchored && <span className="muted small"> (text changed)</span>}
        </blockquote>
      )}
      <CommentBody
        comment={thread}
        actions={
          <>
            {canResolve && (
              <button
                className="link-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  void actions.resolve(thread.id, !isResolved)
                }}
                title={isResolved ? 'Reopen' : 'Mark as resolved'}
              >
                {isResolved ? 'Reopen' : '✓ Resolve'}
              </button>
            )}
            {canDelete(thread.author.id) && (
              <button
                className="link-btn danger"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('Delete this comment thread?')) void actions.remove(thread.id)
                }}
              >
                Delete
              </button>
            )}
          </>
        }
      />
      {isResolved && <p className="muted small">Resolved by {thread.resolvedByName ?? 'someone'} · {timeAgo(thread.resolvedAt!)}</p>}

      {thread.replies.map((r) => (
        <div className="reply" key={r.id}>
          <CommentBody
            comment={r}
            actions={
              canDelete(r.author.id) && (
                <button className="link-btn danger" onClick={() => confirm('Delete this reply?') && void actions.remove(r.id)}>
                  Delete
                </button>
              )
            }
          />
        </div>
      ))}

      {!isResolved && can(role, 'comment') && (active || thread.replies.length > 0) && (
        <form className="reply-form" onSubmit={sendReply} onClick={(e) => e.stopPropagation()}>
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" maxLength={2000} />
          {reply.trim() && (
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Reply
            </button>
          )}
        </form>
      )}
    </article>
  )
}

function CommentBody({
  comment,
  actions,
}: {
  comment: { author: PublicUser; body: string; createdAt: string }
  actions?: React.ReactNode
}) {
  return (
    <div className="comment">
      <div className="comment-head">
        <Avatar user={comment.author} size={24} />
        <span className="comment-author">{comment.author.name}</span>
        <span className="muted small" title={new Date(comment.createdAt).toLocaleString()}>
          {timeAgo(comment.createdAt)}
        </span>
        <span className="comment-actions">{actions}</span>
      </div>
      <p className="comment-text">{comment.body}</p>
    </div>
  )
}
