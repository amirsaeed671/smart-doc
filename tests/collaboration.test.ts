import { beforeEach, describe, expect, it } from 'vitest'
import { addComment, deleteComment, listComments, setResolved } from '@/lib/comments'
import { getDb, resetDbForTests, type Db } from '@/lib/db'
import { createDocument, getDocument, shareDocument, updateDocument } from '@/lib/documents'
import { AppError } from '@/lib/errors'
import { can } from '@/lib/permissions'
import { DEMO_COMMENTS, Q4_DOC_ID, SEED_USERS } from '@/lib/seed'
import { getVersion, listVersions, restoreVersion } from '@/lib/versions'

const [alice, bob, carol] = SEED_USERS
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof AppError && err.status === status)
}

let db: Db
beforeEach(async () => {
  resetDbForTests()
  db = await getDb()
})

describe('role ladder', () => {
  it('each role includes the capabilities of the ones below it', () => {
    expect(['viewer', 'commenter', 'editor', 'owner'].map((r) => [can(r as never, 'comment'), can(r as never, 'edit'), can(r as never, 'manage')])).toEqual([
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ])
  })

  it('commenters can comment but not edit; viewers can do neither', async () => {
    const { id } = await createDocument(db, alice.id, { title: 'Spec' })
    await shareDocument(db, alice.id, id, { email: bob.email, role: 'commenter' })
    await shareDocument(db, alice.id, id, { email: carol.email, role: 'viewer' })

    await expectStatus(updateDocument(db, bob.id, id, { content: doc('x'), baseVersion: 1 }), 403)
    const threads = await addComment(db, bob.id, id, { body: 'Looks good', quote: 'Spec' })
    expect(threads[0]).toMatchObject({ body: 'Looks good', quote: 'Spec', author: { name: bob.name } })

    await expectStatus(addComment(db, carol.id, id, { body: 'hi' }), 403)
    expect(await listComments(db, carol.id, id)).toHaveLength(1) // but viewers can read them
  })
})

describe('comments', () => {
  it('supports threads, resolving and deletion with the right permissions', async () => {
    const { id } = await createDocument(db, alice.id)
    await shareDocument(db, alice.id, id, { email: bob.email, role: 'commenter' })
    await shareDocument(db, alice.id, id, { email: carol.email, role: 'commenter' })

    const [thread] = await addComment(db, bob.id, id, { body: 'Question', quote: 'some text' })
    const [withReply] = await addComment(db, alice.id, id, { body: 'Answer', parentId: thread.id })
    expect(withReply.replies.map((r) => r.body)).toEqual(['Answer'])
    await expectStatus(addComment(db, bob.id, id, { body: 'nested', parentId: withReply.replies[0].id }), 400)

    // Another commenter can't resolve someone else's thread; the author and editors can.
    await expectStatus(setResolved(db, carol.id, id, thread.id, true), 403)
    const [resolved] = await setResolved(db, bob.id, id, thread.id, true)
    expect(resolved.resolvedByName).toBe(bob.name)
    const [reopened] = await setResolved(db, alice.id, id, thread.id, false)
    expect(reopened.resolvedAt).toBeNull()

    await expectStatus(deleteComment(db, carol.id, id, thread.id), 403)
    expect(await deleteComment(db, alice.id, id, thread.id)).toEqual([]) // owner moderates; replies cascade
  })

  it('validates input and scopes comments to the document', async () => {
    const a = await createDocument(db, alice.id)
    const b = await createDocument(db, alice.id)
    await expectStatus(addComment(db, alice.id, a.id, { body: '   ' }), 400)
    await expectStatus(addComment(db, alice.id, a.id, { body: 'x'.repeat(2001) }), 400)
    const [t] = await addComment(db, alice.id, a.id, { body: 'on A' })
    await expectStatus(addComment(db, alice.id, b.id, { body: 'cross-doc reply', parentId: t.id }), 404)
    await expectStatus(listComments(db, bob.id, a.id), 404) // not shared
  })

  it('seeds a demo thread on the shared planning doc', async () => {
    const threads = await listComments(db, bob.id, Q4_DOC_ID)
    expect(threads).toHaveLength(1)
    expect(threads[0].quote).toBe(DEMO_COMMENTS[0].quote)
    expect(threads[0].replies).toHaveLength(1)
  })
})

describe('version history', () => {
  it('folds rapid autosaves by one person into a single session snapshot', async () => {
    const { id } = await createDocument(db, alice.id)
    await shareDocument(db, alice.id, id, { email: bob.email, role: 'editor' })
    await updateDocument(db, alice.id, id, { content: doc('a1'), baseVersion: 1 })
    await updateDocument(db, alice.id, id, { content: doc('a2'), baseVersion: 2 })
    await updateDocument(db, bob.id, id, { content: doc('b1'), baseVersion: 3 })

    const versions = await listVersions(db, alice.id, id)
    expect(versions.map((v) => [v.authorName, v.version, v.label])).toEqual([
      [bob.name, 4, null],
      [alice.name, 3, null],
      [alice.name, 1, 'Created'],
    ])
    expect((await getVersion(db, alice.id, id, versions[1].id)).content).toEqual(doc('a2'))
  })

  it('restores an old version as a new version, and only for editors', async () => {
    const { id } = await createDocument(db, alice.id)
    await shareDocument(db, alice.id, id, { email: bob.email, role: 'commenter' })
    await updateDocument(db, alice.id, id, { content: doc('good'), baseVersion: 1 })
    const [goodSnapshot] = await listVersions(db, alice.id, id)
    // A later session by someone else overwrites it.
    await shareDocument(db, alice.id, id, { email: carol.email, role: 'editor' })
    await updateDocument(db, carol.id, id, { content: doc('oops'), baseVersion: 2 })

    await expectStatus(restoreVersion(db, bob.id, id, goodSnapshot.id), 403)
    const restored = await restoreVersion(db, alice.id, id, goodSnapshot.id)
    expect(restored).toMatchObject({ version: 4, content: doc('good') })

    const [latest] = await listVersions(db, alice.id, id)
    expect(latest.label).toMatch(/^Restored from/)
    expect((await listVersions(db, alice.id, id)).length).toBe(4) // nothing deleted
    expect((await getDocument(db, carol.id, id)).content).toEqual(doc('good'))
  })
})
