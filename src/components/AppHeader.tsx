'use client'

import Link from 'next/link'
import { api, colorFor, initials } from '@/lib/client'
import type { PublicUser } from '@/lib/types'

export function Avatar({ user, size = 30, title }: { user: { id: string; name: string }; size?: number; title?: string }) {
  return (
    <span
      className="avatar"
      title={title ?? user.name}
      style={{ background: colorFor(user.id), width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(user.name)}
    </span>
  )
}

export function AppHeader({ user, children }: { user: PublicUser; children?: React.ReactNode }) {
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }
  return (
    <header className="app-header">
      <Link href="/" className="brand">
        <span className="brand-mark">S</span>
        <span>Smart Doc</span>
      </Link>
      <div className="header-center">{children}</div>
      <div className="header-user">
        <Avatar user={user} title={`${user.name} (${user.email})`} />
        <span className="header-user-name">{user.name}</span>
        <button className="btn btn-ghost" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  )
}
