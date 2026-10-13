import { NextResponse } from 'next/server'
import { errorResponse, readJson } from '@/lib/api'
import { getDb } from '@/lib/db'
import { badRequest, unauthorized } from '@/lib/errors'
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/session'
import { authenticate } from '@/lib/users'

export async function POST(req: Request) {
  try {
    const { email, password } = await readJson(req)
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw badRequest('Email and password are required.')
    }
    const user = await authenticate(await getDb(), email, password)
    if (!user) throw unauthorized('Incorrect email or password.')

    const res = NextResponse.json({ user })
    res.cookies.set(SESSION_COOKIE, await createSessionToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
