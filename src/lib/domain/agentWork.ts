/**
 * 에이전트 작업 루프 상태 머신 — 스펙 §2.2·§4.
 * 순수 함수만 둔다(도메인 계층 관례) — DB·요청 컨텍스트를 모른다.
 */
export type AgentOrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type AgentReportKind = 'progress' | 'completion'

/** WBS Task 단계 순서(§2.5) — depends 선행 게이트(결정 C-①)의 판정 축. */
export const STAGE_ORDER = ['as', 'fp', 'ip', 'im', 'xx'] as const

/** stage 가 min 이상인지 — null·미지 값은 false(fail-closed). 순수 함수. */
export function stageAtLeast(stage: string | null, min: 'im'): boolean {
  if (stage === null) return false
  const stageIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number])
  if (stageIdx === -1) return false
  const minIdx = STAGE_ORDER.indexOf(min)
  return stageIdx >= minIdx
}

export const AGENT_CLAIM_STALE_HOURS = 24
/** 식별 라벨일 뿐 권한 주체가 아니다(권한은 user_email 계정) — 형식만 좁게 잡는다. */
export const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const AGENT_LINKS_MAX = 20
export { UUID_RE, isUuidLike } from './validate'

const TRANSITIONS: Record<AgentOrderStatus, readonly AgentOrderStatus[]> = {
  ready: ['claimed', 'cancelled'],
  claimed: ['ready', 'reported', 'cancelled'],
  reported: ['claimed', 'approved', 'cancelled'],
  // 승인은 종단이 아니다(2026-08-27) — 사람이 무를 수 있다: 검토 대기열 복귀(reported) 또는
  // 에이전트 재작업(claimed). ready 로는 못 간다 — 점유 이력을 지우고 아무나 다시 집게 만들 이유가 없다.
  approved: ['reported', 'claimed'],
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

const SHA_RE = /^[0-9a-f]{40}$/i
const EVIDENCE_KEYS = new Set(['branch', 'base_sha', 'head_sha', 'repo_url', 'pr_url', 'checks'])

/** evidence 는 형식 검증만 — 실재·일치는 서버가 확인하지 않는다(§6). */
export function validateEvidence(raw: unknown):
  { ok: true; evidence: Record<string, unknown> } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, evidence: {} }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'evidence는 객체여야 합니다.' }
  const e = raw as Record<string, unknown>
  for (const k of Object.keys(e)) {
    if (!EVIDENCE_KEYS.has(k)) return { ok: false, error: `evidence에 알 수 없는 필드: ${k}` }
  }
  for (const k of ['base_sha', 'head_sha'] as const) {
    if (e[k] !== undefined && (typeof e[k] !== 'string' || !SHA_RE.test(e[k] as string))) {
      return { ok: false, error: `${k}는 40자 hex여야 합니다.` }
    }
  }
  for (const k of ['repo_url', 'pr_url'] as const) {
    if (e[k] !== undefined && (typeof e[k] !== 'string' || !/^https?:\/\//.test(e[k] as string))) {
      return { ok: false, error: `${k}는 http(s) URL이어야 합니다.` }
    }
  }
  if (e.branch !== undefined && typeof e.branch !== 'string') return { ok: false, error: 'branch는 문자열이어야 합니다.' }
  if (e.checks !== undefined) {
    if (!Array.isArray(e.checks)) return { ok: false, error: 'checks는 배열이어야 합니다.' }
    for (const c of e.checks) {
      if (typeof c !== 'object' || c === null) return { ok: false, error: 'checks 원소는 객체여야 합니다.' }
      const cc = c as Record<string, unknown>
      if (typeof cc.name !== 'string' || typeof cc.status !== 'string') return { ok: false, error: 'checks 원소는 {name,status} 문자열 필드가 필요합니다.' }
    }
  }
  return { ok: true, evidence: e }
}

export const ORDER_PRIORITY_BY_LABEL = { critical: 100, high: 50, medium: 10, low: 0 } as const

/**
 * WBS 항목 priority 라벨을 order.priority 정수로 매핑.
 * 미기재·미지 라벨은 0(low)으로 수렴한다.
 */
export function orderPriorityFromLabel(label: string | null): number {
  if (!label) return 0
  const priority = ORDER_PRIORITY_BY_LABEL[label as keyof typeof ORDER_PRIORITY_BY_LABEL]
  return priority !== undefined ? priority : 0
}
