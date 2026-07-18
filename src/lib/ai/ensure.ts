// ============================================================================
// "쿨다운 + in-flight dedupe + never-throw" ensure 게이트 공용 헬퍼.
// 회의록 인사이트(ensureMinuteInsights)가 쓰던 열람 self-heal 패턴의 일반화 —
// 같은 키(회의록/프로젝트 단위)에 대한 LLM 재생성 폭주를 인스턴스 메모리로 막는다.
// 계약:
//  - fresh() 가 참이면 'ready' (생성 시도 없음)
//  - 같은 키의 생성이 진행 중이면 그 완료를 기다렸다가 결과만 재판정 (중복 호출 0)
//  - 마지막 시도 후 쿨다운 이내면 'unavailable' (무료 쿼터 보호 하한)
//  - 생성 후 fresh() 재확인으로 'generated' | 'unavailable' 판정 (성공 주장 아닌 검증)
//  - 어떤 실패든 절대 throw 하지 않는다: 로그 + 'unavailable' (조용한 삼킴 금지)
// 주의: 상태가 인스턴스 메모리(Map)라 서버리스 다중 인스턴스에서는 완전 직렬화되지
// 않는다 — 최악 중복 1콜은 호출측 DB unique 제약이 행 중복을 막는 전제로 수용한다.
// ============================================================================

export type EnsureState = 'ready' | 'generated' | 'unavailable'

export interface EnsureIo {
  /** 캐시가 신선한가. 생성 전·후 두 번 호출될 수 있다. */
  fresh: () => Promise<boolean>
  /** 실제 생성(내부에서 자체 에러 처리, 실패 = 행 미기록). */
  generate: () => Promise<void>
}

interface EnsureGateOptions {
  /** 키당 재시도 하한 간격(ms). 기본 60초 — RPM 20 무료 쿼터 보호 관례. */
  cooldownMs?: number
  /** 실패 로그 접두어 — 표시(반환 강등)에는 반드시 로깅이 동반돼야 한다. */
  logLabel: string
}

/**
 * ensure 게이트 생성 — 소비처 모듈 로드 시 1회 만들어 키별 상태를 공유한다.
 * (기존 ensureMinuteInsights 의 모듈 스코프 Map 과 동일한 수명 의미론)
 */
export function createEnsureGate(opts: EnsureGateOptions) {
  const inFlight = new Map<string, Promise<void>>()
  const lastAttempt = new Map<string, number>()
  const cooldownMs = opts.cooldownMs ?? 60_000

  return async function ensure(key: string, io: EnsureIo): Promise<EnsureState> {
    try {
      if (await io.fresh()) return 'ready'

      const running = inFlight.get(key)
      if (running) { await running; return (await io.fresh()) ? 'generated' : 'unavailable' }
      const last = lastAttempt.get(key) ?? 0
      if (Date.now() - last < cooldownMs) return 'unavailable'

      lastAttempt.set(key, Date.now())
      const p = io.generate().finally(() => inFlight.delete(key))
      inFlight.set(key, p)
      await p
      return (await io.fresh()) ? 'generated' : 'unavailable'
    } catch (e) {
      console.error(opts.logLabel, e instanceof Error ? e.message : e)
      return 'unavailable'
    }
  }
}
