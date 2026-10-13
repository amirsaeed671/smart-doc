import { NextResponse } from 'next/server'
import { readJson, withUser } from '@/lib/api'
import { deleteComment, setResolved } from '@/lib/comments'
import { badRequest } from '@/lib/errors'

type Params = { id: string; commentId: string }

export const PATCH = withUser<Params>(async ({ req, db, user, params }) => {
  const { resolved } = await readJson(req)
  if (typeof resolved !== 'boolean') throw badRequest('"resolved" must be true or false.')
  return NextResponse.json({ comments: await setResolved(db, user.id, params.id, params.commentId, resolved) })
})

export const DELETE = withUser<Params>(async ({ db, user, params }) =>
  NextResponse.json({ comments: await deleteComment(db, user.id, params.id, params.commentId) }),
)
