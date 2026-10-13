import { NextResponse } from 'next/server'
import { withUser } from '@/lib/api'
import { restoreVersion } from '@/lib/versions'

export const POST = withUser<{ id: string; versionId: string }>(async ({ db, user, params }) =>
  NextResponse.json({ document: await restoreVersion(db, user.id, params.id, params.versionId) }),
)
