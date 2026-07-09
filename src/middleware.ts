import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
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

// 정적 자산(로고 등 public 이미지·아이콘)·API·로그인 경로는 인증 리다이렉트에서 제외 —
// 미제외 시 로그인 페이지에서 /logo.png 요청이 /login 으로 307 되어 로고가 안 뜬다.
// API 엔드포인트는 라우트 핸들러에서 인증을 처리하므로 middleware 제외.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'],
}
