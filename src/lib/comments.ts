import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import { loadAccessible } from './documents'
import { badRequest, forbidden, notFound } from './errors'
import { can } from './permissions'
import type { Comment, CommentThread } from './types'

export const MAX_COMMENT_LENGTH = 2000
export const MAX_QUOTE_LENGTH = 500

type CommentRow = {
  id: string
  parent_id: string | null
  author_id: string
  author_email: string
  author_name: string
  body: string
  quote: string | null
  resolved_at: Date | string | null
  resolved_by_name: string | null
  created_at: Date | string
}

const iso = (d: Date | string) => new Date(d).toISOString()

const toComment = (r: CommentRow): Comment => ({
  id: r.id,
  author: { id: r.author_id, email: r.author_email, name: r.author_name },
  body: r.body,
  createdAt: iso(r.created_at),
})

const isUuid = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function listComments(db: Db, userId: string, docId: string): Promise<CommentThread[]> {
  await loadAccessible(db, userId, docId)
  const rows = await db.query<CommentRow>(
    `SELECT c.id, c.parent_id, c.author_id, a.email AS author_email, a.name AS author_name,
            c.body, c.quote, c.resolved_at, r.name AS resolved_by_name, c.created_at
       FROM document_comments c
       JOIN users a ON a.id = c.author_id
       LEFT JOIN users r ON r.id = c.resolved_by
      WHERE c.document_id = $1
      ORDER BY c.created_at ASC`,
    [docId],
  )
  const threads = new Map<string, CommentThread>()
  for (const r of rows) {
    if (r.parent_id) continue
    threads.set(r.id, {
      ...toComment(r),
      quote: r.quote,
      resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
      resolvedByName: r.resolved_by_name,
      replies: [],
    })
  }
  for (const r of rows) if (r.parent_id) threads.get(r.parent_id)?.replies.push(toComment(r))
  return [...threads.values()]
}

export async function addComment(
  db: Db,
  userId: string,
  docId: string,
  input: { body?: unknown; quote?: unknown; parentId?: unknown },
): Promise<CommentThread[]> {
  const doc = await loadAccessible(db, userId, docId)
  if (!can(doc.role, 'comment')) throw forbidden('Viewers cannot comment. Ask the owner for commenter access.')

  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body) throw badRequest('Comment cannot be empty.')
  if (body.length > MAX_COMMENT_LENGTH) throw badRequest(`Comments are limited to ${MAX_COMMENT_LENGTH} characters.`)

  let parentId: string | null = null
  let quote: string | null = null
  if (input.parentId !== undefined && input.parentId !== null) {
    if (!isUuid(input.parentId)) throw badRequest('Invalid parent comment.')
    const [parent] = await db.query<{ parent_id: string | null }>(
      'SELECT parent_id FROM document_comments WHERE id = $1 AND document_id = $2',
      [input.parentId, docId],
    )
    if (!parent) throw notFound('The comment you replied to no longer exists.')
    if (parent.parent_id) throw badRequest('Replies cannot be nested.')
    parentId = input.parentId
  } else if (typeof input.quote === 'string' && input.quote.trim()) {
    quote = input.quote.trim().slice(0, MAX_QUOTE_LENGTH)
  }

  await db.query(
    `INSERT INTO document_comments (id, document_id, parent_id, author_id, body, quote) VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), docId, parentId, userId, body, quote],
  )
  return listComments(db, userId, docId)
}

async function loadThread(db: Db, docId: string, commentId: string) {
  if (!isUuid(commentId)) throw notFound('Comment not found.')
  const [row] = await db.query<{ author_id: string; parent_id: string | null }>(
    'SELECT author_id, parent_id FROM document_comments WHERE id = $1 AND document_id = $2',
    [commentId, docId],
  )
  if (!row) throw notFound('Comment not found.')
  return row
}

/** Editors and the thread's author can resolve/reopen. */
export async function setResolved(
  db: Db,
  userId: string,
  docId: string,
  commentId: string,
  resolved: boolean,
): Promise<CommentThread[]> {
  const doc = await loadAccessible(db, userId, docId)
  const comment = await loadThread(db, docId, commentId)
  if (comment.parent_id) throw badRequest('Only whole threads can be resolved.')
  if (!can(doc.role, 'edit') && comment.author_id !== userId) {
    throw forbidden('Only editors or the comment author can resolve this thread.')
  }
  await db.query(
    resolved
      ? 'UPDATE document_comments SET resolved_at = now(), resolved_by = $2 WHERE id = $1'
      : 'UPDATE document_comments SET resolved_at = NULL, resolved_by = NULL WHERE id = $1 AND $2::uuid IS NOT NULL',
    [commentId, userId],
  )
  return listComments(db, userId, docId)
}

/** Authors can delete their own comments; the owner can delete any (moderation). */
export async function deleteComment(db: Db, userId: string, docId: string, commentId: string): Promise<CommentThread[]> {
  const doc = await loadAccessible(db, userId, docId)
  const comment = await loadThread(db, docId, commentId)
  if (comment.author_id !== userId && !can(doc.role, 'manage')) {
    throw forbidden('You can only delete your own comments.')
  }
  await db.query('DELETE FROM document_comments WHERE id = $1', [commentId])
  return listComments(db, userId, docId)
}
