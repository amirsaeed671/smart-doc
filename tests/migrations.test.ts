import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import type { Db } from '@/lib/db'
import { migrate, MIGRATIONS } from '@/lib/migrations'

describe('migrations', () => {
  it('upgrades a database created by the first release (no migrations table) without data loss', async () => {
    const pg = new PGlite('memory://')
    const db: Db = { query: async (sql, params) => (await pg.query(sql, params)).rows as never }

    // State of the already-deployed database: v1 tables, created before migrations were tracked.
    for (const stmt of MIGRATIONS[0].sql!.split(';').filter((s) => s.trim())) await db.query(stmt)
    await db.query(`INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001', 'a@x.dev', 'A', 'h', now())`)
    await db.query(
      `INSERT INTO documents (id, owner_id, title, content) VALUES ('00000000-0000-4000-9000-000000000009', '00000000-0000-4000-8000-000000000001', 'Old', '{"type":"doc"}')`,
    )

    await migrate(db)
    await migrate(db) // idempotent on re-run (every cold start calls it)

    const versions = await db.query<{ label: string }>('SELECT label FROM document_versions')
    expect(versions).toEqual([{ label: 'Initial version' }]) // history backfilled for existing docs
    await db.query(
      `INSERT INTO document_shares VALUES ('00000000-0000-4000-9000-000000000009', '00000000-0000-4000-8000-000000000001', 'commenter', now())`,
    ) // new role accepted by the rewritten CHECK constraint
    const applied = await db.query<{ id: number }>('SELECT id FROM schema_migrations ORDER BY id')
    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id))
  })
})
