import { NextResponse } from 'next/server'
import { readJson, withUser } from '@/lib/api'
import { deleteDocument, getDocument, updateDocument } from '@/lib/documents'

type Params = { id: string }

export const GET = withUser<Params>(async ({ db, user, params }) =>
  NextResponse.json({ document: await getDocument(db, user.id, params.id) }),
)

export const PATCH = withUser<Params>(async ({ req, db, user, params }) => {
  const body = await readJson(req)
  const document = await updateDocument(db, user.id, params.id, {
    title: body.title,
    content: body.content,
    baseVersion: body.baseVersion,
  })
  return NextResponse.json({ document })
})

export const DELETE = withUser<Params>(async ({ db, user, params }) => {
  await deleteDocument(db, user.id, params.id)
  return new NextResponse(null, { status: 204 })
})
