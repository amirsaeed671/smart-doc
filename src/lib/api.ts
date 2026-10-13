import 'server-only'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getDb, type Db } from './db'
import { AppError, badRequest, unauthorized } from './errors'
import { readSessionToken, SESSION_COOKIE } from './session'
import type { PublicUser } from './types'
import { getUserById } from './users'

export async function currentUser(db: Db): Promise<PublicUser | null> {
  const store = await cookies()
  const session = await readSessionToken(store.get(SESSION_COOKIE)?.value)
  if (!session) return null
  // Re-check the DB so a session for a deleted user (e.g. after a DB reset) is rejected.
  return getUserById(db, session.id)
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { message: err.message, code: err.code, details: err.details } }, { status: err.status })
  }
  console.error(err)
  return NextResponse.json({ error: { message: 'Something went wrong. Please try again.', code: 'internal' } }, { status: 500 })
}

type Ctx<P> = { params: Promise<P> }

/** Wrap a route handler with auth, DB access and uniform error handling. */
export function withUser<P = Record<string, string>>(
  handler: (args: { req: Request; db: Db; user: PublicUser; params: P }) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const db = await getDb()
      const user = await currentUser(db)
      if (!user) throw unauthorized()
      return await handler({ req, db, user, params: await ctx.params })
    } catch (err) {
      return errorResponse(err)
    }
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw badRequest('Request body must be a JSON object.')
  }
}
