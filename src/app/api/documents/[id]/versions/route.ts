import { NextResponse } from 'next/server'
import { withUser } from '@/lib/api'
import { listVersions } from '@/lib/versions'

export const GET = withUser<{ id: string }>(async ({ db, user, params }) =>
  NextResponse.json({ versions: await listVersions(db, user.id, params.id) }),
)
