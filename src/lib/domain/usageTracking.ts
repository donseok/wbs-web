/**
 * 사용 기록 수집 여부.
 *
 * 로컬 dev 가 프로덕션 Supabase 를 공유하므로(CLAUDE.md) 개발 중 클릭이 그대로 운영
 * 지표에 쌓인다. 그래서 기본값은 "프로덕션에서만". Preview 도 자동으로 제외된다.
 *   USAGE_TRACKING=on   로컬/Preview 검증용 명시적 opt-in
 *   USAGE_TRACKING=off  운영 긴급 차단(다른 무엇보다 우선)
 */
export function trackingEnabled(env: Record<string, string | undefined>): boolean {
  if (env.USAGE_TRACKING === 'off') return false
  if (env.USAGE_TRACKING === 'on') return true
  return env.VERCEL_ENV === 'production'
}
