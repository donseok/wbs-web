import { createClient } from '@supabase/supabase-js'

/**
 * 서비스 롤(service_role) 클라이언트 — 서버 전용. RLS 를 우회하므로
 * 절대 클라이언트 컴포넌트에서 import 하지 말 것. (임베딩 색인 쓰기, 의미검색 RPC 호출용)
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service_role 환경변수가 설정되지 않았습니다.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
