import type { Db } from './db'
import { insertDemoComments } from './seed'

/**
 * Ordered, append-only schema migrations. Each runs once and is recorded in
 * `schema_migrations`. Statements are written to be idempotent as well, so two
 * serverless cold starts racing on a fresh database can't break anything.
 * (Statements are split on ';', so don't use semicolons inside a statement.)
 */
export const MIGRATIONS: { id: number; name: string; sql?: string; run?: (db: Db) => Promise<void> }[] = [
  {
    id: 1,
    name: 'base schema',
    sql: /* sql */ `
      CREATE TABLE IF NOT EXISTS users (
        id            uuid PRIMARY KEY,
        email         text NOT NULL UNIQUE,
        name          text NOT NULL,
        password_hash text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS documents (
        id          uuid PRIMARY KEY,
        owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       text NOT NULL,
        content     jsonb NOT NULL,
        version     integer NOT NULL DEFAULT 1,
        updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents(owner_id);
      CREATE TABLE IF NOT EXISTS document_shares (
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role        text NOT NULL CHECK (role IN ('viewer', 'editor')),
        created_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (document_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS document_shares_user_idx ON document_shares(user_id)
    `,
  },
  {
    id: 2,
    name: 'commenter role, comments, version history',
    sql: /* sql */ `
      ALTER TABLE document_shares DROP CONSTRAINT IF EXISTS document_shares_role_check;
      ALTER TABLE document_shares ADD CONSTRAINT document_shares_role_check
        CHECK (role IN ('viewer', 'commenter', 'editor'));

      CREATE TABLE IF NOT EXISTS document_comments (
        id          uuid PRIMARY KEY,
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        parent_id   uuid REFERENCES document_comments(id) ON DELETE CASCADE,
        author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body        text NOT NULL,
        quote       text,
        resolved_at timestamptz,
        resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS document_comments_doc_idx ON document_comments(document_id);

      CREATE TABLE IF NOT EXISTS document_versions (
        id          uuid PRIMARY KEY,
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version     integer NOT NULL,
        title       text NOT NULL,
        content     jsonb NOT NULL,
        author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
        label       text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS document_versions_doc_idx ON document_versions(document_id, updated_at DESC);

      INSERT INTO document_versions (id, document_id, version, title, content, author_id, label, created_at, updated_at)
      SELECT gen_random_uuid(), d.id, d.version, d.title, d.content, d.updated_by, 'Initial version', d.updated_at, d.updated_at
      FROM documents d
      WHERE NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id)
    `,
  },
  {
    // Existing deployments were seeded before comments existed; fresh databases get these from seedDatabase.
    id: 3,
    name: 'demo comment thread',
    run: insertDemoComments,
  },
  {
    // Supabase exposes the public schema over its REST API to anyone holding the (public) anon key.
    // RLS with no policies denies those roles everything. The app connects as the table owner,
    // which bypasses RLS, and enforces access itself in the API layer.
    id: 4,
    name: 'enable row level security',
    sql: /* sql */ `
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
      ALTER TABLE document_comments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY
    `,
  },
]

export async function migrate(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
  const applied = new Set(
    (await db.query<{ id: number }>('SELECT id FROM schema_migrations')).map((r) => Number(r.id)),
  )
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    if (m.run) await m.run(db)
    for (const statement of (m.sql ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.query(statement)
    }
    await db.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, m.name])
  }
}
