// LLM 제공자별 기본 엔드포인트.
// provider.ts 의 env 폴백과 llm-override.ts 의 "빈 base_url → 기본 엔드포인트" 해석이
// 같은 값을 써야 하므로(둘이 어긋나면 URL 조합이 갈라진다) 여기 한 곳에 모은다.

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

/**
 * 프로필 base_url → 실제로 호출에 쓸 베이스 URL.
 * 빈값이면 provider 기본 엔드포인트, 그리고 **끝 슬래시를 반드시 제거**한다.
 * llm.ts 가 `${baseUrl}/chat/completions` 처럼 나이브하게 이어 붙이므로, 슬래시가 남으면
 * `.../v1//chat/completions` 가 되어 404 다. 저장 시점(액션)·연결 테스트·런타임 로더가
 * 모두 이 함수를 거쳐야 "테스트는 성공인데 실사용만 죽는" 괴리가 생기지 않는다.
 */
export function normalizeBaseUrl(provider: 'gemini' | 'openai', raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (trimmed) return trimmed
  return provider === 'openai' ? DEFAULT_OPENAI_BASE_URL : DEFAULT_GEMINI_BASE_URL
}
