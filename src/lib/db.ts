import 'server-only'
import { migrate } from './migrations'
import { seedDatabase } from './seed'

/**
 * Minimal query interface shared by the two backends we support:
 *  - node-postgres against a real Postgres (Supabase in production)
 *  - PGlite (embedded WASM Postgres) for zero-setup local dev and tests
 * Both speak the same SQL dialect and `$1` placeholders, so the rest of the
 * app never needs to know which one it is talking to.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

async function createPgDb(url: string): Promise<Db> {
  const { Pool } = await import('pg')
  const pool = new Pool({
    connectionString: url,
    // Serverless functions are short-lived; keep the footprint tiny and rely on
    // Supabase's pooler for fan-out.
    max: 3,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
  })
  return {
    async query(sql, params = []) {
      const res = await pool.query(sql, params)
      return res.rows
    },
  }
}

async function createPgliteDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  if (!dataDir.startsWith('memory://')) {
    const fs = await import('node:fs')
    fs.mkdirSync(dataDir, { recursive: true })
  }
  const pg = new PGlite(dataDir)
  return {
    async query(sql, params = []) {
      const res = await pg.query(sql, params)
      return res.rows as never
    },
  }
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL
  if (!url && process.env.VERCEL) {
    throw new Error('DATABASE_URL must be set in production (see README → Deploy).')
  }
  if (url && process.env.VERCEL && /@db\.[a-z0-9]+\.supabase\.co/.test(url)) {
    // Supabase's direct host is IPv6-only and Vercel has no IPv6 egress (fails with ENOTFOUND).
    throw new Error(
      'DATABASE_URL uses the Supabase direct connection (db.<ref>.supabase.co), which Vercel cannot reach. ' +
        'Use the Transaction pooler URI instead (…pooler.supabase.com:6543).',
    )
  }
  const db = url ? await createPgDb(url) : await createPgliteDb(process.env.PGLITE_DIR ?? '.data/pglite')
  await migrate(db)
  await seedDatabase(db)
  return db
}

// Cache across hot reloads in dev and across invocations of a warm lambda.
const globalForDb = globalThis as unknown as { __smartDocDb?: Promise<Db> }

export function getDb(): Promise<Db> {
  if (!globalForDb.__smartDocDb) {
    globalForDb.__smartDocDb = init().catch((err) => {
      globalForDb.__smartDocDb = undefined
      throw err
    })
  }
  return globalForDb.__smartDocDb
}

/** Test helper: drop the cached connection so each suite gets a fresh in-memory DB. */
export function resetDbForTests() {
  globalForDb.__smartDocDb = undefined
}
