import type { Db } from './db'
import { hashPassword } from './passwords'

/**
 * Demo accounts so reviewers can test sharing without signing up.
 * Fixed ids make seeding idempotent even if several cold starts race.
 */
export const DEMO_PASSWORD = 'demo1234'
export const SEED_USERS = [
  { id: '00000000-0000-4000-8000-000000000001', email: 'alice@ajaia.dev', name: 'Alice Chen' },
  { id: '00000000-0000-4000-8000-000000000002', email: 'bob@ajaia.dev', name: 'Bob Patel' },
  { id: '00000000-0000-4000-8000-000000000003', email: 'carol@ajaia.dev', name: 'Carol Diaz' },
] as const

const [alice, bob] = SEED_USERS

export const Q4_DOC_ID = '00000000-0000-4000-9000-000000000001'

/** A sample comment thread, so reviewers see comments without creating one first. */
export const DEMO_COMMENTS = [
  {
    id: '00000000-0000-4000-a000-000000000001',
    parent: null,
    author: bob.id,
    quote: 'Decide on real-time co-editing',
    body: 'Presence + conflict detection covers the pilot. Can we revisit CRDT co-editing after we get feedback?',
  },
  {
    id: '00000000-0000-4000-a000-000000000002',
    parent: '00000000-0000-4000-a000-000000000001',
    author: alice.id,
    quote: null,
    body: 'Agreed, adding it to the next planning cycle.',
  },
]

export async function insertDemoComments(db: Db): Promise<void> {
  for (const c of DEMO_COMMENTS) {
    await db.query(
      `INSERT INTO document_comments (id, document_id, parent_id, author_id, body, quote)
       SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM documents WHERE id = $2)
       ON CONFLICT DO NOTHING`,
      [c.id, Q4_DOC_ID, c.parent, c.author, c.body, c.quote],
    )
  }
}

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const li = (text: string) => ({ type: 'listItem', content: [p(text)] })

const SEED_DOCS = [
  {
    id: Q4_DOC_ID,
    owner: alice.id,
    title: 'Q4 Planning Notes',
    shares: [{ user: bob.id, role: 'editor' }],
    content: {
      type: 'doc',
      content: [
        h(1, 'Q4 Planning Notes'),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Shared with ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'Bob' },
            { type: 'text', text: ' as an editor. Open this as Bob in another browser to see ' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'live presence and sync' },
            { type: 'text', text: '.' },
          ],
        },
        h(2, 'Priorities'),
        { type: 'orderedList', content: [li('Ship the doc editor pilot'), li('Collect feedback from two teams'), li('Decide on real-time co-editing')] },
        h(2, 'Open questions'),
        { type: 'bulletList', content: [li('Do we need comments in v1?'), li('Which file types matter most?')] },
      ],
    },
  },
  {
    id: '00000000-0000-4000-9000-000000000002',
    owner: bob.id,
    title: 'Team Offsite Ideas',
    shares: [{ user: alice.id, role: 'viewer' }],
    content: {
      type: 'doc',
      content: [
        h(1, 'Team Offsite Ideas'),
        p('Alice has view-only access to this document, so the toolbar is disabled for her.'),
        { type: 'bulletList', content: [li('Hackathon day'), li('Customer panel'), li('Dinner somewhere with a view')] },
      ],
    },
  },
]

export async function seedDatabase(db: Db): Promise<void> {
  const [{ count }] = await db.query<{ count: string | number }>('SELECT count(*) AS count FROM users')
  if (Number(count) > 0) return

  for (const u of SEED_USERS) {
    await db.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [u.id, u.email, u.name, hashPassword(DEMO_PASSWORD)],
    )
  }
  for (const d of SEED_DOCS) {
    await db.query(
      `INSERT INTO documents (id, owner_id, title, content, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $2) ON CONFLICT DO NOTHING`,
      [d.id, d.owner, d.title, JSON.stringify(d.content)],
    )
    for (const s of d.shares) {
      await db.query(
        'INSERT INTO document_shares (document_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [d.id, s.user, s.role],
      )
    }
    await db.query(
      `INSERT INTO document_versions (id, document_id, version, title, content, author_id, label)
       VALUES (gen_random_uuid(), $1, 1, $2, $3::jsonb, $4, 'Created')`,
      [d.id, d.title, JSON.stringify(d.content), d.owner],
    )
  }
  await insertDemoComments(db)
}
