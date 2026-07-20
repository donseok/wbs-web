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
  // getUser() 가 아니라 getClaims() 를 쓴다 — getUser() 는 매 요청 GoTrue /auth/v1/user 로
  // 네트워크 왕복을 강제하지만(클릭당 100~180ms), 이 프로젝트의 JWT 는 비대칭 서명(ES256/EC,
  // JWKS 키 1개·대칭 oct 키 없음)이라 getClaims() 가 JWKS 캐시로 로컬 서명 검증만 하고 끝난다.
  // (대칭 HS* 키였다면 getClaims 가 내부적으로 getUser() 로 폴백해 이득이 0이 된다.)
  //
  // 쿠키를 직접 디코드하는 방식으로 바꾸지 말 것: 이 호출은 인증 게이트인 동시에 토큰 자동
  // 갱신 지점이다. getClaims() → getSession() → 만료 시 _callRefreshToken 경로가 갱신 토큰을
  // 발급하고, 위 setAll 이 그 쿠키를 res 에 싣는다. RSC 클라이언트는 Next 15 에서 쿠키 쓰기가
  // 막혀 있어 갱신을 영속할 수 없으므로, 여기서 갱신이 빠지면 액세스 토큰 수명(기본 1h) 뒤
  // 사용자가 조용히 로그아웃된다.
  const { data } = await sb.auth.getClaims()
  const isLogin = req.nextUrl.pathname.startsWith('/login')
  if (!data?.claims && !isLogin) return NextResponse.redirect(new URL('/login', req.url))
  return res
}

// 정적 자산(로고 등 public 이미지·아이콘)·API·로그인 경로는 인증 리다이렉트에서 제외 —
// 미제외 시 로그인 페이지에서 /logo.png 요청이 /login 으로 307 되어 로고가 안 뜬다.
// API 엔드포인트는 라우트 핸들러에서 인증을 처리하므로 middleware 제외.
// /share/** 는 비로그인 외부 열람 경로 — 토큰 검증은 페이지가 수행.
// `share/` 로 앵커: 접두사만 쓰면 /share-xxx 같은 미래 경로까지 인증이 풀린다.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api|share/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'],
}
