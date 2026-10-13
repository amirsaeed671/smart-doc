import 'server-only'
import { randomUUID } from 'node:crypto'
import type { JSONContent } from '@tiptap/core'
import type { Db } from './db'
import { getDocument, loadAccessible } from './documents'
import { forbidden, notFound } from './errors'
import { can } from './permissions'
import type { DocumentDetail, VersionDetail, VersionSummary } from './types'

/**
 * Autosave writes every ~second, so storing a snapshot per save would bury the
 * history in noise. Instead, consecutive saves by the same person within this
 * window are folded into one "editing session" snapshot, like Google Docs does.
 */
export const SESSION_WINDOW_MINUTES = 10

type VersionRow = {
  id: string
  version: number
  title: string
  content?: JSONContent
  author_name: string | null
  label: string | null
  created_at: Date | string
  updated_at: Date | string
}

const iso = (d: Date | string) => new Date(d).toISOString()

function toSummary(r: VersionRow): VersionSummary {
  return {
    id: r.id,
    version: r.version,
    title: r.title,
    authorName: r.author_name,
    label: r.label,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

export async function recordVersion(
  db: Db,
  v: { documentId: string; userId: string; version: number; title: string; content: JSONContent; label?: string },
): Promise<void> {
  if (!v.label) {
    // Extend the current session snapshot if it's the same author, recent, and not a milestone (created/restored).
    const extended = await db.query(
      `UPDATE document_versions
          SET version = $3, title = $4, content = $5::jsonb, updated_at = now()
        WHERE id = (SELECT id FROM document_versions WHERE document_id = $1 ORDER BY updated_at DESC LIMIT 1)
          AND author_id = $2 AND label IS NULL
          AND updated_at > now() - make_interval(mins => $6)
        RETURNING id`,
      [v.documentId, v.userId, v.version, v.title, JSON.stringify(v.content), SESSION_WINDOW_MINUTES],
    )
    if (extended.length > 0) return
  }
  await db.query(
    `INSERT INTO document_versions (id, document_id, version, title, content, author_id, label)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [randomUUID(), v.documentId, v.version, v.title, JSON.stringify(v.content), v.userId, v.label ?? null],
  )
}

const VERSION_COLUMNS = `v.id, v.version, v.title, v.label, v.created_at, v.updated_at, u.name AS author_name`

export async function listVersions(db: Db, userId: string, docId: string): Promise<VersionSummary[]> {
  await loadAccessible(db, userId, docId)
  const rows = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM document_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.document_id = $1 ORDER BY v.updated_at DESC, v.version DESC LIMIT 100`,
    [docId],
  )
  return rows.map(toSummary)
}

export async function getVersion(db: Db, userId: string, docId: string, versionId: string): Promise<VersionDetail> {
  await loadAccessible(db, userId, docId)
  const [row] = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS}, v.content FROM document_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.document_id = $1 AND v.id::text = $2`,
    [docId, versionId],
  )
  if (!row) throw notFound('Version not found.')
  return { ...toSummary(row), content: row.content! }
}

/**
 * Restoring never deletes history: the old content becomes a new version on
 * top, so a restore can itself be undone from the history panel.
 */
export async function restoreVersion(db: Db, userId: string, docId: string, versionId: string): Promise<DocumentDetail> {
  const doc = await loadAccessible(db, userId, docId)
  if (!can(doc.role, 'edit')) throw forbidden('Only editors can restore versions.')
  const snapshot = await getVersion(db, userId, docId, versionId)
  const [{ version }] = await db.query<{ version: number }>(
    `UPDATE documents SET content = $2::jsonb, version = version + 1, updated_at = now(), updated_by = $3
      WHERE id = $1 RETURNING version`,
    [docId, JSON.stringify(snapshot.content), userId],
  )
  const when = new Date(snapshot.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  await recordVersion(db, {
    documentId: docId,
    userId,
    version,
    title: doc.title,
    content: snapshot.content,
    label: `Restored from ${when} UTC`,
  })
  return getDocument(db, userId, docId)
}
