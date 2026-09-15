/**
 * 에이전트 작업 루프 상태 머신 — 스펙 §2.2·§4.
 * 순수 함수만 둔다(도메인 계층 관례) — DB·요청 컨텍스트를 모른다.
 */
export type AgentOrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type AgentReportKind = 'progress' | 'completion'

/** WBS Task 단계 순서(스펙 2026-09-15 §3.2) — fp 는 0096 에서 ip 로 이관됐다. */
export const STAGE_ORDER = ['as', 'ip', 'im', 'xx'] as const

/** "완료 도달"로 보는 단계 — §2.10 알림·선행 게이트 판정 축. */
export const REACHED_STAGES: ReadonlySet<string> = new Set(['im', 'xx'])

/**
 * 선행 충족(§3.7) = stage ∈ {im,xx} ∨ 승인된 주문 ∨ 실적 ≥ 100. 세 번째 축은 위임하지 않은 사람 Task 가
 * 선행일 때 드롭다운 없이 풀리게 한다. claim 게이트·대기 사유·WBS 착수 판정·unblocked 알림이 전부 이 함수다.
 * 실적은 원시값 비교(statusOf 의 done 판정과 같다 — 99.6 은 완료가 아니다).
 */
export function predecessorReached(p: { stage: string | null; orderApproved?: boolean; actualPct?: number | null }): boolean {
  if (p.stage !== null && REACHED_STAGES.has(p.stage)) return true
  if (p.orderApproved === true) return true
  return typeof p.actualPct === 'number' && Number.isFinite(p.actualPct) && p.actualPct >= 100
}

/** 에이전트가 쥐고 있는 주문 status — ready 는 dev_workflow 리프마다 상주하므로 넣지 않는다(스펙 §3.5). */
export const AGENT_HELD_ORDER_STATUSES = ['claimed', 'reported'] as const

/**
 * 사람의 단계 지정·실적 100 입력 잠금(§3.5·§3.6) = 위임됨 ∨ 에이전트가 주문을 쥠. 위임된 ready 주문은
 * /dflow-poll 이 자동 claim 하므로 잠그지 않으면 사람이 찍은 완료가 claim 사건으로 되돌아간다.
 * RPC apply_workflow_event 의 set_stage 가 같은 조건을 SQL 로 복제한다(tests/migrations/0096 이 대조).
 */
export function stageLockedForHuman(p: { delegated: boolean; orderStatus: string | null }): boolean {
  return p.delegated || (p.orderStatus !== null && (AGENT_HELD_ORDER_STATUSES as readonly string[]).includes(p.orderStatus))
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
