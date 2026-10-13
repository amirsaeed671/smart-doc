import 'server-only'
import type { Db } from './db'
import type { PublicUser } from './types'
import { verifyPassword } from './passwords'

type UserRow = { id: string; email: string; name: string; password_hash: string }

const toPublic = (u: { id: string; email: string; name: string }): PublicUser => ({ id: u.id, email: u.email, name: u.name })

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export async function authenticate(db: Db, email: string, password: string): Promise<PublicUser | null> {
  const [user] = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)])
  if (!user || !verifyPassword(password, user.password_hash)) return null
  return toPublic(user)
}

export async function getUserById(db: Db, id: string): Promise<PublicUser | null> {
  const [user] = await db.query<UserRow>('SELECT id, email, name FROM users WHERE id = $1', [id])
  return user ? toPublic(user) : null
}

export async function getUserByEmail(db: Db, email: string): Promise<PublicUser | null> {
  const [user] = await db.query<UserRow>('SELECT id, email, name FROM users WHERE email = $1', [normalizeEmail(email)])
  return user ? toPublic(user) : null
}

export async function listUsers(db: Db): Promise<PublicUser[]> {
  const rows = await db.query<UserRow>('SELECT id, email, name FROM users ORDER BY name')
  return rows.map(toPublic)
}
