import { NextResponse } from 'next/server'
import { withUser } from '@/lib/api'
import { getVersion } from '@/lib/versions'

export const GET = withUser<{ id: string; versionId: string }>(async ({ db, user, params }) =>
  NextResponse.json({ version: await getVersion(db, user.id, params.id, params.versionId) }),
)
