import { NextResponse } from 'next/server'
import { withUser } from '@/lib/api'
import { removeShare } from '@/lib/documents'

export const DELETE = withUser<{ id: string; userId: string }>(async ({ db, user, params }) =>
  NextResponse.json({ shares: await removeShare(db, user.id, params.id, params.userId) }),
)
