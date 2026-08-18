import { createServerClient as create } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerClient() {
  const cookieStore = await cookies()
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          // RSC 렌더 중에는 Next 15 가 쿠키 쓰기를 throw 로 막는다. 토큰 갱신 영속은
          // 미들웨어가 책임지므로(src/middleware.ts — { request } 전파) 여기서는 무해화한다.
          // 안 감싸면 렌더 중 우연히 갱신이 겹칠 때 페이지 전체가 500 이 된다.
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        },
      },
    },
  )
}
