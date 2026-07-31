/**
 * 에이전트 작업 루프 상태 머신 — 스펙 §2.2·§4.
 * 순수 함수만 둔다(도메인 계층 관례) — DB·요청 컨텍스트를 모른다.
 */
export type AgentOrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type AgentReportKind = 'progress' | 'completion'

export const AGENT_CLAIM_STALE_HOURS = 24
/** 식별 라벨일 뿐 권한 주체가 아니다(권한은 user_email 계정) — 형식만 좁게 잡는다. */
export const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const AGENT_LINKS_MAX = 20
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TRANSITIONS: Record<AgentOrderStatus, readonly AgentOrderStatus[]> = {
  ready: ['claimed', 'cancelled'],
  claimed: ['ready', 'reported', 'cancelled'],
  reported: ['claimed', 'approved', 'cancelled'],
  approved: [],
  cancelled: [],
}

export function canTransition(from: AgentOrderStatus, to: AgentOrderStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** null = 유효. 문자열 = 400 사유. progress 100 을 막아 완료를 승인 경로로 강제한다(스펙 §4-1). */
export function validateReport(kind: AgentReportKind, percent: number): string | null {
  if (!Number.isInteger(percent)) return 'percent는 정수여야 합니다.'
  if (kind === 'progress') {
    if (percent < 0 || percent > 99) return 'progress percent는 0~99입니다. 완료는 kind=completion으로 요청하세요.'
    return null
  }
  if (percent !== 100) return 'completion percent는 100이어야 합니다.'
  return null
}

export function isClaimStale(claimedAt: string | null, now: Date = new Date()): boolean {
  if (!claimedAt) return false
  const t = Date.parse(claimedAt)
  if (Number.isNaN(t)) return false
  return now.getTime() - t > AGENT_CLAIM_STALE_HOURS * 3600_000
}

export function isUuidLike(v: string): boolean {
  return UUID_RE.test(v)
}
