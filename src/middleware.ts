import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  // 데모 모드: 인증 우회 (NEXT_PUBLIC_DEMO_MODE=1). 운영 환경에서는 켜지 말 것.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') return res
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    },
  )
  const { data } = await sb.auth.getUser()
  const isLogin = req.nextUrl.pathname.startsWith('/login')
  if (!data.user && !isLogin) return NextResponse.redirect(new URL('/login', req.url))
  return res
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|login|preview).*)'] }
