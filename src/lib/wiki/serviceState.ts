/**
 * Wiki 자동화 상태의 읽기 전용 정본.
 *
 * 회의록 저장 경로와 크론 워커 중 하나라도 멈춰 있으면 새 지식이 지속적으로 반영되지
 * 않으므로 UI에는 `paused`로 표시한다. 두 값 모두 대소문자까지 정확히 `true`일 때만
 * 활성으로 본다. 이 모듈은 ingest 코드를 import하지 않아 읽기 화면이 LLM/관리자 클라이언트
 * 의존성을 끌어오지 않게 한다.
 */
export type WikiAutomationState = 'active' | 'paused'
export interface WikiAutomationEnv {
  WIKI_SERVICE_ENABLED?: string
  WIKI_WORKER_ENABLED?: string
}

export function wikiAutomationState(
  env: WikiAutomationEnv = {
    WIKI_SERVICE_ENABLED: process.env.WIKI_SERVICE_ENABLED,
    WIKI_WORKER_ENABLED: process.env.WIKI_WORKER_ENABLED,
  },
): WikiAutomationState {
  return env.WIKI_SERVICE_ENABLED === 'true' && env.WIKI_WORKER_ENABLED === 'true'
    ? 'active'
    : 'paused'
}
