import { NextResponse } from 'next/server'
import { withUser } from '@/lib/api'
import { listUsers } from '@/lib/users'

// Small internal tool: every signed-in user can see the directory to pick someone to share with.
export const GET = withUser(async ({ db, user }) => {
  const users = await listUsers(db)
  return NextResponse.json({ users: users.filter((u) => u.id !== user.id) })
})
