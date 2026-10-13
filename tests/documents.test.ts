import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDbForTests, type Db } from '@/lib/db'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  listShares,
  removeShare,
  shareDocument,
  updateDocument,
} from '@/lib/documents'
import { AppError } from '@/lib/errors'
import { SEED_USERS } from '@/lib/seed'

const [alice, bob, carol] = SEED_USERS

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.status === status)
}

let db: Db
beforeEach(async () => {
  resetDbForTests() // fresh in-memory Postgres (PGlite) per test
  db = await getDb()
})

describe('document ownership and sharing', () => {
  it('only the owner and explicitly shared users can see a document', async () => {
    const created = await createDocument(db, alice.id, { title: '  Roadmap  ' })
    expect(created.title).toBe('Roadmap')
    expect(created.role).toBe('owner')

    await expectStatus(getDocument(db, carol.id, created.id), 404)

    await shareDocument(db, alice.id, created.id, { email: 'CAROL@ajaia.dev', role: 'viewer' })
    const asCarol = await getDocument(db, carol.id, created.id)
    expect(asCarol.role).toBe('viewer')

    const carolsList = await listDocuments(db, carol.id)
    expect(carolsList.owned).toHaveLength(0)
    expect(carolsList.shared.map((d) => d.id)).toContain(created.id)

    const alicesList = await listDocuments(db, alice.id)
    expect(alicesList.owned.map((d) => d.id)).toContain(created.id)
  })

  it('viewers cannot edit, editors can, and only owners manage sharing or delete', async () => {
    const { id } = await createDocument(db, alice.id, { title: 'Spec' })
    await shareDocument(db, alice.id, id, { email: bob.email, role: 'editor' })
    await shareDocument(db, alice.id, id, { email: carol.email, role: 'viewer' })

    await expectStatus(updateDocument(db, carol.id, id, { content: doc('nope'), baseVersion: 1 }), 403)
    const edited = await updateDocument(db, bob.id, id, { content: doc('from bob'), baseVersion: 1 })
    expect(edited.version).toBe(2)
    expect(edited.updatedByName).toBe(bob.name)

    await expectStatus(shareDocument(db, bob.id, id, { email: carol.email, role: 'editor' }), 403)
    await expectStatus(deleteDocument(db, bob.id, id), 403)

    await removeShare(db, alice.id, id, carol.id)
    await expectStatus(getDocument(db, carol.id, id), 404)
    expect((await listShares(db, alice.id, id)).map((s) => s.user.email)).toEqual([bob.email])

    await deleteDocument(db, alice.id, id)
    await expectStatus(getDocument(db, bob.id, id), 404)
  })

  it('rejects sharing with unknown users or the owner', async () => {
    const { id } = await createDocument(db, alice.id)
    await expectStatus(shareDocument(db, alice.id, id, { email: 'nobody@example.com' }), 404)
    await expectStatus(shareDocument(db, alice.id, id, { email: alice.email }), 400)
    await expectStatus(shareDocument(db, alice.id, id, { email: bob.email, role: 'admin' }), 400)
  })
})

describe('saving content', () => {
  it('persists rich-text structure exactly as saved', async () => {
    const { id } = await createDocument(db, alice.id)
    const rich = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'underline' }], text: 'item' }] }],
            },
          ],
        },
      ],
    }
    await updateDocument(db, alice.id, id, { content: rich, baseVersion: 1 })
    const reopened = await getDocument(db, alice.id, id)
    expect(reopened.content).toEqual(rich)
  })

  it('detects concurrent edits instead of silently overwriting (optimistic locking)', async () => {
    const { id } = await createDocument(db, alice.id)
    await shareDocument(db, alice.id, id, { email: bob.email, role: 'editor' })

    await updateDocument(db, alice.id, id, { content: doc('alice v2'), baseVersion: 1 })
    // Bob still thinks he is editing version 1.
    const stale = updateDocument(db, bob.id, id, { content: doc('bob from v1'), baseVersion: 1 })
    await expect(stale).rejects.toMatchObject({ status: 409, details: { latest: { version: 2 } } })

    expect((await getDocument(db, bob.id, id)).content).toEqual(doc('alice v2'))
  })

  it('rejects content that does not match the editor schema', async () => {
    const { id } = await createDocument(db, alice.id)
    const bad = { type: 'doc', content: [{ type: 'script', content: [] }] }
    await expectStatus(updateDocument(db, alice.id, id, { content: bad, baseVersion: 1 }), 400)
    await expectStatus(updateDocument(db, alice.id, id, { content: doc('x') }), 400) // missing baseVersion
  })

  it('renaming does not bump the content version (no false conflicts)', async () => {
    const { id } = await createDocument(db, alice.id)
    const renamed = await updateDocument(db, alice.id, id, { title: 'New name' })
    expect(renamed).toMatchObject({ title: 'New name', version: 1 })
    await expectStatus(updateDocument(db, alice.id, id, { title: 'x'.repeat(201) }), 400)
  })
})
