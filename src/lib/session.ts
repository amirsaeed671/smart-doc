import { jwtVerify, SignJWT } from 'jose'
import type { PublicUser } from './types'

// Edge-safe (used by middleware): only Web Crypto via `jose`, no Node APIs.

export const SESSION_COOKIE = 'smartdoc_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET
  if (!value) {
    // Fail closed on real deployments; allow a fixed dev secret for local runs (incl. `next start`).
    if (process.env.VERCEL) throw new Error('SESSION_SECRET must be set in production.')
    return new TextEncoder().encode('dev-only-insecure-secret-do-not-use-in-prod')
  }
  return new TextEncoder().encode(value)
}

export async function createSessionToken(user: PublicUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret())
}

export async function readSessionToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (!payload.sub) return null
    return { id: payload.sub, email: String(payload.email), name: String(payload.name) }
  } catch {
    return null
  }
}
