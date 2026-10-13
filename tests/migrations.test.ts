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
  it('locks every table against non-owner roles (Supabase anon/authenticated) while the app keeps access', async () => {
    const pg = new PGlite('memory://')
    const db: Db = { query: async (sql, params) => (await pg.query(sql, params)).rows as never }
    await migrate(db)
    await db.query(`INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001', 'a@x.dev', 'A', 'h', now())`)

    const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    expect(tables.filter((t) => !t.rowsecurity)).toEqual([])

    // Simulate Supabase's anon role: even with table privileges granted, RLS hides every row.
    await db.query('CREATE ROLE anon')
    await db.query('GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO anon')
    await db.query('SET ROLE anon')
    expect(await db.query('SELECT * FROM users')).toEqual([])
    await expect(db.query(`INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000002', 'b@x.dev', 'B', 'h', now())`)).rejects.toThrow(/row-level security/)
    await db.query('RESET ROLE')
    expect(await db.query('SELECT id FROM users')).toHaveLength(1) // owner (the app) unaffected
  })
})
