import { NextResponse } from 'next/server'
import { readJson, withUser } from '@/lib/api'
import { addComment, listComments } from '@/lib/comments'

type Params = { id: string }

export const GET = withUser<Params>(async ({ db, user, params }) =>
  NextResponse.json({ comments: await listComments(db, user.id, params.id) }),
)

export const POST = withUser<Params>(async ({ req, db, user, params }) => {
  const body = await readJson(req)
  const comments = await addComment(db, user.id, params.id, { body: body.body, quote: body.quote, parentId: body.parentId })
  return NextResponse.json({ comments }, { status: 201 })
})
