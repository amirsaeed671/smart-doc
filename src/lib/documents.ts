import 'server-only'
import { randomUUID } from 'node:crypto'
import type { JSONContent } from '@tiptap/core'
import type { Db } from './db'
import { assertValidContent, docToPlainText } from './content'
import { EMPTY_DOC } from './editor-schema'
import { badRequest, conflict, forbidden, notFound } from './errors'
import type { DocumentDetail, DocumentSummary, Role, Share, ShareRole } from './types'
import { getUserByEmail } from './users'

export const MAX_TITLE_LENGTH = 200
export const DEFAULT_TITLE = 'Untitled document'

type DocRow = {
  id: string
  title: string
  content: JSONContent
  version: number
  owner_id: string
  owner_email: string
  owner_name: string
  updated_at: Date | string
  updated_by_name: string | null
  role: Role
}

// Every read goes through this query so access control lives in one place:
// a row is returned only if the user owns the document or it is shared with them.
const ACCESSIBLE_DOCS_SQL = /* sql */ `
  SELECT d.id, d.title, d.content, d.version, d.owner_id, d.updated_at,
         o.email AS owner_email, o.name AS owner_name,
         ub.name AS updated_by_name,
         CASE WHEN d.owner_id = $1 THEN 'owner' ELSE s.role END AS role
  FROM documents d
  JOIN users o ON o.id = d.owner_id
  LEFT JOIN users ub ON ub.id = d.updated_by
  LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = $1
  WHERE (d.owner_id = $1 OR s.user_id IS NOT NULL)
`

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

function previewFor(row: DocRow): string {
  const text = docToPlainText(row.content)
  // Docs usually open with their title as a heading; don't repeat it in the preview.
  return text.startsWith(row.title) ? text.slice(row.title.length).trim() : text
}

function toSummary(row: DocRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    owner: { id: row.owner_id, email: row.owner_email, name: row.owner_name },
    preview: previewFor(row),
    updatedAt: iso(row.updated_at),
    updatedByName: row.updated_by_name,
  }
}

function toDetail(row: DocRow): DocumentDetail {
  return { ...toSummary(row), content: row.content, version: row.version }
}

export function normalizeTitle(title: unknown): string {
  if (title === undefined || title === null) return DEFAULT_TITLE
  if (typeof title !== 'string') throw badRequest('Title must be a string.')
  const trimmed = title.replace(/\s+/g, ' ').trim()
  if (trimmed.length > MAX_TITLE_LENGTH) throw badRequest(`Title must be at most ${MAX_TITLE_LENGTH} characters.`)
  return trimmed || DEFAULT_TITLE
}

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

async function loadAccessible(db: Db, userId: string, docId: string): Promise<DocRow> {
  // Treat malformed ids and documents the user can't see identically, so the
  // API never reveals whether a document exists.
  if (!isUuid(docId)) throw notFound()
  const [row] = await db.query<DocRow>(`${ACCESSIBLE_DOCS_SQL} AND d.id = $2`, [userId, docId])
  if (!row) throw notFound()
  return row
}

export const canEdit = (role: Role) => role === 'owner' || role === 'editor'

export async function listDocuments(db: Db, userId: string) {
  const rows = await db.query<DocRow>(`${ACCESSIBLE_DOCS_SQL} ORDER BY d.updated_at DESC`, [userId])
  const docs = rows.map(toSummary)
  return {
    owned: docs.filter((d) => d.role === 'owner'),
    shared: docs.filter((d) => d.role !== 'owner'),
  }
}

export async function getDocument(db: Db, userId: string, docId: string): Promise<DocumentDetail> {
  return toDetail(await loadAccessible(db, userId, docId))
}

export async function createDocument(
  db: Db,
  userId: string,
  input: { title?: unknown; content?: unknown } = {},
): Promise<DocumentDetail> {
  const title = normalizeTitle(input.title)
  const content = input.content === undefined ? EMPTY_DOC : assertValidContent(input.content)
  const id = randomUUID()
  await db.query(
    `INSERT INTO documents (id, owner_id, title, content, updated_by) VALUES ($1, $2, $3, $4::jsonb, $2)`,
    [id, userId, title, JSON.stringify(content)],
  )
  return getDocument(db, userId, id)
}

/**
 * Rename and/or replace content.
 *
 * Content saves use optimistic concurrency: the client sends the version it
 * started editing from, and the write only lands if nobody saved in between.
 * Otherwise we return 409 with the latest document so the client can resolve
 * the conflict instead of silently clobbering a collaborator's work.
 */
export async function updateDocument(
  db: Db,
  userId: string,
  docId: string,
  input: { title?: unknown; content?: unknown; baseVersion?: unknown },
): Promise<DocumentDetail> {
  const row = await loadAccessible(db, userId, docId)
  if (!canEdit(row.role)) throw forbidden('You have view-only access to this document.')
  if (input.title === undefined && input.content === undefined) throw badRequest('Nothing to update.')

  if (input.title !== undefined) {
    await db.query(`UPDATE documents SET title = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [
      docId,
      normalizeTitle(input.title),
      userId,
    ])
  }

  if (input.content !== undefined) {
    const content = assertValidContent(input.content)
    if (!Number.isInteger(input.baseVersion)) throw badRequest('baseVersion is required when saving content.')
    const updated = await db.query(
      `UPDATE documents
         SET content = $2::jsonb, version = version + 1, updated_at = now(), updated_by = $3
       WHERE id = $1 AND version = $4
       RETURNING id`,
      [docId, JSON.stringify(content), userId, input.baseVersion],
    )
    if (updated.length === 0) {
      const latest = await getDocument(db, userId, docId)
      throw conflict('This document was changed by someone else since you started editing.', { latest })
    }
  }

  return getDocument(db, userId, docId)
}

export async function deleteDocument(db: Db, userId: string, docId: string): Promise<void> {
  const row = await loadAccessible(db, userId, docId)
  if (row.role !== 'owner') throw forbidden('Only the owner can delete this document.')
  await db.query('DELETE FROM documents WHERE id = $1', [docId])
}

export async function listShares(db: Db, userId: string, docId: string): Promise<Share[]> {
  await loadAccessible(db, userId, docId)
  const rows = await db.query<{ id: string; email: string; name: string; role: ShareRole; created_at: Date }>(
    `SELECT u.id, u.email, u.name, s.role, s.created_at
       FROM document_shares s JOIN users u ON u.id = s.user_id
      WHERE s.document_id = $1 ORDER BY u.name`,
    [docId],
  )
  return rows.map((r) => ({ user: { id: r.id, email: r.email, name: r.name }, role: r.role, createdAt: iso(r.created_at) }))
}

const SHARE_ROLES: ShareRole[] = ['viewer', 'editor']

/** Grant (or change) access for another user. Owner only. Idempotent. */
export async function shareDocument(
  db: Db,
  userId: string,
  docId: string,
  input: { email?: unknown; role?: unknown },
): Promise<Share[]> {
  const row = await loadAccessible(db, userId, docId)
  if (row.role !== 'owner') throw forbidden('Only the owner can change sharing.')
  if (typeof input.email !== 'string' || !input.email.includes('@')) throw badRequest('Enter a valid email address.')
  const role = (input.role ?? 'editor') as ShareRole
  if (!SHARE_ROLES.includes(role)) throw badRequest('Role must be "viewer" or "editor".')

  const target = await getUserByEmail(db, input.email)
  if (!target) throw notFound(`No user with email ${input.email.trim()}.`)
  if (target.id === row.owner_id) throw badRequest('You already own this document.')

  await db.query(
    `INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [docId, target.id, role],
  )
  return listShares(db, userId, docId)
}

export async function removeShare(db: Db, userId: string, docId: string, targetUserId: string): Promise<Share[]> {
  const row = await loadAccessible(db, userId, docId)
  if (row.role !== 'owner') throw forbidden('Only the owner can change sharing.')
  await db.query('DELETE FROM document_shares WHERE document_id = $1 AND user_id = $2', [docId, targetUserId])
  return listShares(db, userId, docId)
}
