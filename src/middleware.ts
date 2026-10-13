import { NextResponse, type NextRequest } from 'next/server'
import { readSessionToken, SESSION_COOKIE } from '@/lib/session'

// Page-level gate only; API routes do their own auth and return JSON 401s.
export async function middleware(req: NextRequest) {
  const user = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value)
  const isLogin = req.nextUrl.pathname === '/login'
  if (!user && !isLogin) {
    const url = new URL('/login', req.url)
    if (req.nextUrl.pathname !== '/') url.searchParams.set('next', req.nextUrl.pathname)
    return NextResponse.redirect(url)
  }
  if (user && isLogin) return NextResponse.redirect(new URL('/', req.url))
  return NextResponse.next()
}

export const config = { matcher: ['/', '/login', '/docs/:path*'] }
