import { NextResponse } from 'next/server'
import { readJson, withUser } from '@/lib/api'
import { listShares, shareDocument } from '@/lib/documents'

type Params = { id: string }

export const GET = withUser<Params>(async ({ db, user, params }) =>
  NextResponse.json({ shares: await listShares(db, user.id, params.id) }),
)

export const POST = withUser<Params>(async ({ req, db, user, params }) => {
  const body = await readJson(req)
  const shares = await shareDocument(db, user.id, params.id, { email: body.email, role: body.role })
  return NextResponse.json({ shares })
})
