'use client'

import { useState } from 'react'
import { api, ApiError } from '@/lib/client'

const DEMO_USERS = [
  { email: 'alice@ajaia.dev', name: 'Alice Chen' },
  { email: 'bob@ajaia.dev', name: 'Bob Patel' },
  { email: 'carol@ajaia.dev', name: 'Carol Diaz' },
]
const DEMO_PASSWORD = 'demo1234'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: string, p: string) {
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: e, password: p }) })
      const next = new URLSearchParams(window.location.search).get('next')
      window.location.href = next?.startsWith('/') && !next.startsWith('//') ? next : '/'
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.')
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark">S</span>
          <span>Smart Doc</span>
        </div>
        <p className="muted">Lightweight collaborative documents for teams.</p>

        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            signIn(email, password)
          }}
        >
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="demo-accounts">
          <p className="muted small">
            Demo accounts (password <code>{DEMO_PASSWORD}</code>). Open two browsers to try sharing and live sync.
          </p>
          <div className="demo-buttons">
            {DEMO_USERS.map((u) => (
              <button key={u.email} className="btn" disabled={busy} onClick={() => signIn(u.email, DEMO_PASSWORD)}>
                {u.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
