/**
 * 에이전트 작업 루프 상태 머신 — 스펙 §2.2·§4.
 * 순수 함수만 둔다(도메인 계층 관례) — DB·요청 컨텍스트를 모른다.
 */
export type AgentOrderStatus = 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
export type AgentReportKind = 'progress' | 'completion'

/** WBS Task 단계 순서(스펙 2026-09-15 §3.2) — fp 는 0096 에서 ip 로 이관됐다. ds(설계 중)는 0107 에서 as 와 ip 사이. */
export const STAGE_ORDER = ['as', 'ds', 'ip', 'im', 'xx'] as const

/** "완료 도달"로 보는 단계 — §2.10 알림·선행 게이트 판정 축. ds 는 도달이 아니다(설계만 끝난 선행은 후행을 풀지 않는다). */
export const REACHED_STAGES: ReadonlySet<string> = new Set(['im', 'xx'])

/**
 * 선행 충족(§3.7) = 면제(강제 진행, 스펙 2026-09-23 F2) ∨ stage ∈ {im,xx} ∨ 승인된 주문 ∨ 실적 ≥ 100.
 * 면제는 간선 단위다 — 호출부가 그 선행이 후행의 depends_waived 에 드는지 넘긴다.
 * 세 번째 축은 위임하지 않은 사람 Task 가
 * 선행일 때 드롭다운 없이 풀리게 한다. claim 게이트·대기 사유·WBS 착수 판정·unblocked 알림이 전부 이 함수다.
 * 실적은 원시값 비교(statusOf 의 done 판정과 같다 — 99.6 은 완료가 아니다).
 */
export function predecessorReached(p: { stage: string | null; orderApproved?: boolean; actualPct?: number | null; waived?: boolean }): boolean {
  if (p.waived === true) return true
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
/** 식별 라벨일 뿐 권한 주체가 아니다(권한은 user_email 계정) — 형식만 좁게 잡는다.
 *  `/` 로 나눈 세그먼트를 허용한다 — 팀원 라벨 `<신원>/<host>/w<슬롯>`(resumeHostFromClaimLabel·agentRoster 가 전제).
 *  세그먼트마다 첫 글자는 영숫자라 빈 세그먼트·`..` 는 거부된다. 전체 상한은 heartbeat·watch 의 AGENT_MAX(120)와 같다. */
export const AGENT_NAME_RE = /^(?=.{1,120}$)[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
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

/**
 * 재개 요청이 지목할 PC — 점유 라벨(claimed_by)에서 호스트를 뽑아 agent_watchers.host 와 같은 축의
 * 슬러그로 맞춘다. 규칙은 dflow.sh 의 slug()·host_short() 와 같다(소문자, [a-z0-9-] 밖은 '-').
 * 라벨 두 형태를 다 받는다: 단독 러너의 `claude-<host>`(cmd_claim)와 팀원의 `<신원>/<host>/w<슬롯>`.
 * 클라이언트가 보낸 값을 쓰지 않는 이유: 호스트가 틀리면 워크트리가 없는 PC 의 팀장이 집어 가고,
 * 진행 중 작업은 원격 브랜치가 대개 없으므로 그 산출물을 아무도 복구하지 못한다.
 */
export function resumeHostFromClaimLabel(claimedBy: string | null): string | null {
  const label = (claimedBy ?? '').trim()
  if (label === '') return null
  const parts = label.split('/')
  const raw = parts.length >= 2 ? parts[1] : (label.startsWith('claude-') ? label.slice('claude-'.length) : label)
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return slug === '' || /^-+$/.test(slug) ? null : slug
}

// ---- 워커 결정 목록(과제 C, 스펙 2026-09-23-worker-decision-report-design.md §3.3) ----
// 상한은 DB CHECK(0102, 20건)·CLI 선검사(dflow.sh DECISION* 변수)와 같다. 대조는 tests/skills/dflow-done-decisions.test.ts.
export const AGENT_DECISIONS_MAX = 20
export const AGENT_DECISION_OPTIONS_MIN = 2
export const AGENT_DECISION_OPTIONS_MAX = 6
export const AGENT_DECISION_QUESTION_MAX = 300
export const AGENT_DECISION_OPTION_MAX = 200
export const AGENT_DECISION_RATIONALE_MAX = 1000
export const AGENT_DECISION_ON_REJECT_MAX = 500
const DECISION_KEY_RE = /^D[1-9][0-9]?$/
const DECISION_FIELDS = new Set(['key', 'question', 'options', 'chosen', 'rationale', 'on_reject'])

/** 워커가 기본값 없는 분기에서 스스로 고른 결정 하나. chosen 은 options 의 색인이다(문구 일치 검증을 피한다, D4). */
export interface AgentDecision {
  key: string; question: string; options: string[]; chosen: number; rationale: string; on_reject: string
}
/** 화면용 상태 — none = 제출 안 됨(구 CLI·구 서버), ok = 형식 통과(0건 포함), invalid = 저장 값이 앱 규칙을 어김. */
export type DecisionsParse = { state: 'none' } | { state: 'ok'; items: AgentDecision[] } | { state: 'invalid' }

/** trim 뒤 코드포인트 1~max 자면 trim 값, 아니면 null. jq 의 length 와 같은 축으로 센다(CLI 선검사와 경계가 같아야 한다). */
function decisionText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  const n = Array.from(t).length
  return n >= 1 && n <= max ? t : null
}

/**
 * decisions 형식 검증 — 내용의 참·거짓은 판정하지 않는다(evidence §6 과 같은 입장). 실패 사유는 필드 경로를 담는다.
 * undefined = 필드 없음(제출 안 됨) → decisions:null. 명시적 null 은 배열이 아니므로 거부한다(fail-loud).
 */
export function validateDecisions(raw: unknown):
  { ok: true; decisions: AgentDecision[] | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, decisions: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'decisions는 배열이어야 합니다.' }
  if (raw.length > AGENT_DECISIONS_MAX) return { ok: false, error: `decisions는 ${AGENT_DECISIONS_MAX}건 이하여야 합니다.` }
  const out: AgentDecision[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const p = `decisions[${i}]`
    const d = raw[i]
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return { ok: false, error: `${p}는 객체여야 합니다.` }
    const r = d as Record<string, unknown>
    for (const k of Object.keys(r)) {
      if (!DECISION_FIELDS.has(k)) return { ok: false, error: `${p}에 알 수 없는 필드: ${k}` }
    }
    if (typeof r.key !== 'string' || !DECISION_KEY_RE.test(r.key)) return { ok: false, error: `${p}.key는 D1~D99 형식이어야 합니다.` }
    if (seen.has(r.key)) return { ok: false, error: `${p}.key가 중복됩니다: ${r.key}` }
    seen.add(r.key)
    const question = decisionText(r.question, AGENT_DECISION_QUESTION_MAX)
    if (question === null) return { ok: false, error: `${p}.question은 1~${AGENT_DECISION_QUESTION_MAX}자여야 합니다.` }
    if (!Array.isArray(r.options) || r.options.length < AGENT_DECISION_OPTIONS_MIN || r.options.length > AGENT_DECISION_OPTIONS_MAX) {
      return { ok: false, error: `${p}.options는 ${AGENT_DECISION_OPTIONS_MIN}~${AGENT_DECISION_OPTIONS_MAX}개여야 합니다.` }
    }
    const options: string[] = []
    for (let j = 0; j < r.options.length; j++) {
      const o = decisionText(r.options[j], AGENT_DECISION_OPTION_MAX)
      if (o === null) return { ok: false, error: `${p}.options[${j}]는 1~${AGENT_DECISION_OPTION_MAX}자여야 합니다.` }
      options.push(o)
    }
    if (typeof r.chosen !== 'number' || !Number.isInteger(r.chosen)) return { ok: false, error: `${p}.chosen은 정수여야 합니다.` }
    if (r.chosen < 0 || r.chosen >= options.length) return { ok: false, error: `${p}.chosen이 options 범위를 벗어났습니다.` }
    const rationale = decisionText(r.rationale, AGENT_DECISION_RATIONALE_MAX)
    if (rationale === null) return { ok: false, error: `${p}.rationale은 1~${AGENT_DECISION_RATIONALE_MAX}자여야 합니다.` }
    const onReject = decisionText(r.on_reject, AGENT_DECISION_ON_REJECT_MAX)
    if (onReject === null) return { ok: false, error: `${p}.on_reject는 1~${AGENT_DECISION_ON_REJECT_MAX}자여야 합니다.` }
    out.push({ key: r.key, question, options, chosen: r.chosen, rationale, on_reject: onReject })
  }
  return { ok: true, decisions: out }
}

/**
 * 저장된 decisions 를 화면 상태로. DB CHECK 가 배열만 보장하고 항목 모양은 앱 검증뿐이라 다시 본다.
 * null 을 0건으로 그리지 않는다(스펙 §10 "모름을 0건으로 보이지 않는다").
 */
export function parseDecisions(raw: unknown): DecisionsParse {
  if (raw === null || raw === undefined) return { state: 'none' }
  const v = validateDecisions(raw)
  return v.ok && v.decisions !== null ? { state: 'ok', items: v.decisions } : { state: 'invalid' }
}

/**
 * 명세 패널 "에이전트 진행 상황" 요약 표(2026-09-23 사용자 요청: 시작·종료·진행 분·모델).
 * 시작 = 착수(claimed_at)와 첫 보고 중 이른 쪽 — 재작업으로 다시 claim 하면 claimed_at 이 뒤로 밀려
 * 첫 보고보다 늦어질 수 있다. 종료 = 완료 보고가 올라간 상태(reported·approved)의 마지막 completion.
 * 진행 분 = 종료(없고 작업 중이면 지금, 그 밖엔 마지막 보고)까지. 모델은 heartbeat 가 살아 있을 때만
 * 믿는다(0100 — last_heartbeat_at 이 null 이면 무효). 보고마다의 간격 분은 직전 보고(첫 행은 시작)부터다.
 */
export type OrderTimeline = {
  startedAt: string | null; endedAt: string | null; minutes: number | null; model: string | null
  /** reports 와 같은 순서 — 직전 보고(첫 행은 시작)부터 이 보고까지의 분. 시작을 모르면 null. */
  gaps: (number | null)[]
  /** 작업 중(claimed)일 때 마지막 보고(없으면 시작)부터 지금까지의 분 — 표의 「진행 중」 줄. 그 밖엔 null. */
  openMinutes: number | null
}
export function orderTimeline(order: {
  status: string; claimed_at: string | null
  heartbeat_model?: string | null; last_heartbeat_at?: string | null
  reports: ReadonlyArray<{ kind: string; created_at: string }>
}, now: Date = new Date()): OrderTimeline {
  const ms = (s: string) => new Date(s).getTime()
  const min = (a: number, b: number) => Math.max(0, Math.floor((b - a) / 60_000))
  const first = order.reports[0]?.created_at ?? null
  const startedAt = order.claimed_at && first ? (ms(order.claimed_at) <= ms(first) ? order.claimed_at : first) : (order.claimed_at ?? first)
  const lastCompletion = [...order.reports].reverse().find(r => r.kind === 'completion')?.created_at ?? null
  const endedAt = order.status === 'reported' || order.status === 'approved' ? lastCompletion : null
  const until = endedAt ?? (order.status === 'claimed' ? now.toISOString() : (order.reports.at(-1)?.created_at ?? null))
  const minutes = startedAt && until ? min(ms(startedAt), ms(until)) : null
  const model = order.last_heartbeat_at ? (order.heartbeat_model ?? null) : null
  const gaps = order.reports.map((r, i) => {
    const prev = i === 0 ? startedAt : order.reports[i - 1].created_at
    return prev ? min(ms(prev), ms(r.created_at)) : null
  })
  const openFrom = order.reports.at(-1)?.created_at ?? startedAt
  const openMinutes = order.status === 'claimed' && openFrom ? min(ms(openFrom), now.getTime()) : null
  return { startedAt, endedAt, minutes, model, gaps, openMinutes }
}

/**
 * 사용 토큰(0104) — heartbeat 훅이 싣는 세션 누적값. 훅이 셸로 대화 기록을 합치므로 LLM 토큰을 쓰지 않는다.
 * `tokens` 는 선택이다: 없으면 null(아무것도 쓰지 않음), 형식이 틀리면 error(요청 전체를 400 으로 거절).
 * 세션 id 는 Claude Code 세션 UUID, 모델은 transcript 의 message.model 이다(0100 과 같은 이름 규칙).
 */
export type TokenCounts = { input: number; output: number; cache_creation: number; cache_read: number }
export type TokenUsagePayload = { session: string; models: Array<{ model: string } & TokenCounts> }
export const TOKEN_MODELS_MAX = 20
/** 한 세션·모델의 누적 상한 — 1조. 정상 사용량의 몇 자릿수 위라 오염된 값만 걸러낸다. */
const TOKEN_COUNT_MAX = 1_000_000_000_000
const TOKEN_SESSION_RE = /^[A-Za-z0-9-]{1,64}$/
const TOKEN_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,63}$/
export function parseTokenUsage(raw: unknown): { ok: true; value: TokenUsagePayload | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'tokens 는 객체여야 합니다.' }
  const t = raw as Record<string, unknown>
  if (typeof t.session !== 'string' || !TOKEN_SESSION_RE.test(t.session)) return { ok: false, error: 'tokens.session 은 영숫자·하이픈 64자 이하여야 합니다.' }
  if (!Array.isArray(t.models) || t.models.length > TOKEN_MODELS_MAX) return { ok: false, error: `tokens.models 는 ${TOKEN_MODELS_MAX}개 이하 배열이어야 합니다.` }
  const count = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= TOKEN_COUNT_MAX ? v : null)
  const models: TokenUsagePayload['models'] = []
  const seen = new Set<string>()
  for (const m of t.models) {
    const r = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
    if (typeof r.model !== 'string' || !TOKEN_MODEL_RE.test(r.model) || seen.has(r.model)) return { ok: false, error: 'tokens.models[].model 이 올바르지 않거나 중복입니다.' }
    const c = { input: count(r.input), output: count(r.output), cache_creation: count(r.cache_creation), cache_read: count(r.cache_read) }
    if (Object.values(c).some(v => v === null)) return { ok: false, error: 'tokens 의 토큰 수는 0 이상 정수여야 합니다.' }
    seen.add(r.model)
    models.push({ model: r.model, ...(c as TokenCounts) })
  }
  return { ok: true, value: { session: t.session, models } }
}

/** 주문의 토큰 행(세션×모델)을 모델별·전체로 합친다 — 명세 패널 진행 표의 「토큰」 줄. 행이 없으면 null. */
export type TokenRow = { model: string; input_tokens: number; output_tokens: number; cache_creation_tokens: number; cache_read_tokens: number }
export function sumTokenUsage(rows: ReadonlyArray<TokenRow>): { total: TokenCounts; byModel: Array<{ model: string } & TokenCounts> } | null {
  if (rows.length === 0) return null
  const by = new Map<string, TokenCounts>()
  const total: TokenCounts = { input: 0, output: 0, cache_creation: 0, cache_read: 0 }
  for (const r of rows) {
    const c = by.get(r.model) ?? { input: 0, output: 0, cache_creation: 0, cache_read: 0 }
    // PostgREST 는 bigint 를 문자열로 줄 수 있다 — Number 로 받는다(토큰 수는 2^53 안이다).
    const add = { input: Number(r.input_tokens), output: Number(r.output_tokens), cache_creation: Number(r.cache_creation_tokens), cache_read: Number(r.cache_read_tokens) }
    for (const k of Object.keys(add) as (keyof TokenCounts)[]) { c[k] += add[k]; total[k] += add[k] }
    by.set(r.model, c)
  }
  const tot = (c: TokenCounts) => c.input + c.output + c.cache_creation + c.cache_read
  const byModel = [...by].map(([model, c]) => ({ model, ...c })).sort((a, b) => tot(b) - tot(a))
  return { total, byModel }
}

/** 1234 → 1.2k, 1234567 → 1.2M. 표 칸이 좁아 유효 숫자 둘로 줄인다. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}
