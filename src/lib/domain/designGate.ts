/**
 * 설계 상태·구현자동 — 규칙 원본(스펙 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 3·5절,
 * 12절이 본문보다 우선, 계획서 docs/superpowers/plans/2026-09-27-design-state-dev-auto.md P1~P16).
 * 관문(canClaim·canBuildStart·canReportCompletion·canRelease·canDesignDone)·판단(nextAgentAction·isMine)·PC 판정·
 * 화면 판정(designScreen·designButtons)을 여기 하나에 둔다(D7). 순수 함수만 — DB·요청을 모른다.
 * 라우트가 관문을 집행하고, 목록·상세·watch 가 판단을 싣고, 좌석·WBS·허브가 화면 판정을 쓴다.
 * 전이 RPC(0108 apply_workflow_event)는 원자 전이와 CAS 만 한다.
 */
import type { AgentOrderStatus } from './agentWork'
import { STALE_MS } from './seatState'

export const DESIGN_MODES = ['auto', 'review', 'human'] as const
export type DesignMode = (typeof DESIGN_MODES)[number]
export const DESIGN_STATES = ['review', 'accepted'] as const
export type DesignState = (typeof DESIGN_STATES)[number]
/** claim_scope 에 저장되는 값. 빈 값(0108 이전·2.9 앱의 claim)은 legacy 로 본다(D8). */
export const CLAIM_SCOPES = ['full', 'design', 'build', 'legacy'] as const
export type ClaimScope = (typeof CLAIM_SCOPES)[number]
/** claim 요청이 보낼 수 있는 범위 — 보내지 않으면 legacy. */
export const CLAIM_REQUEST_SCOPES = ['full', 'design', 'build'] as const
export const BUILD_SCOPES = ['full', 'build', 'rework', 'legacy'] as const
export type BuildScope = (typeof BUILD_SCOPES)[number]
export type AgentAction = 'full' | 'design' | 'build' | 'skip' | 'wait'

/** D25 — 도는 PC 가 이만큼 조용하면 다른 PC 가 이어받을 수 있다(긴 명령 하나가 heartbeat 없이 도는 시간보다 길게). */
export const RUNNER_STALE_MS = 30 * 60_000
/** Y12 — 질문(BLOCKED)한 워커를 살아 있다고 보는 상한: 팀장 TICK(기본 30분) 두 번. */
export const BLOCKED_MAX_AGE_MS = 2 * 30 * 60_000

const PROGRESSED: ReadonlySet<string> = new Set(['ip', 'im', 'xx'])
const WAIT_PHASES: ReadonlySet<string> = new Set(['wait_review', 'wait_pred'])

export const stageAtOrPastIp = (stage: string | null): boolean => stage !== null && PROGRESSED.has(stage)
export const toDesignMode = (v: unknown): DesignMode =>
  typeof v === 'string' && (DESIGN_MODES as readonly string[]).includes(v) ? (v as DesignMode) : 'auto'
export const toDesignState = (v: unknown): DesignState | null =>
  typeof v === 'string' && (DESIGN_STATES as readonly string[]).includes(v) ? (v as DesignState) : null
export const toClaimScope = (v: unknown): ClaimScope =>
  typeof v === 'string' && (CLAIM_SCOPES as readonly string[]).includes(v) ? (v as ClaimScope) : 'legacy'

/**
 * 에이전트 라벨의 PC(3절, P5). `<신원>/<host>/<슬롯>` 은 둘째 칸, 수동 세션 `claude-<host>` 는 접두어를 뗀 값(L1),
 * 그 밖의 옛 라벨은 라벨 전체다. dflow.sh 의 slug 가 이미 소문자지만 비교는 소문자로 맞춘다.
 */
export function pcOfLabel(label: string | null): string | null {
  const l = (label ?? '').trim()
  if (l === '') return null
  const parts = l.split('/')
  const pc = parts.length >= 2 ? parts[1] : l.startsWith('claude-') ? l.slice('claude-'.length) : l
  return pc === '' ? null : pc.toLowerCase()
}

/** 팀원 라벨(`…/w<n>`) — 팀장은 이 라벨이 점유한 claimed 주문만 이어받는다(Y9). */
export const isWorkerLabel = (label: string | null): boolean => /\/w[0-9]+$/.test(label ?? '')

/** met = 미충족 선행 없음, ahead = 미충족이 모두 dd·ip(설계 선행 가능, D15), blocked = 그 밖. */
export type PredsState = 'met' | 'ahead' | 'blocked'
export function predsState(unmet: ReadonlyArray<{ stage: string | null }>): PredsState {
  if (unmet.length === 0) return 'met'
  return unmet.every(d => d.stage === 'dd' || d.stage === 'ip') ? 'ahead' : 'blocked'
}

export type ItemFacts = {
  mode: DesignMode
  stage: string | null
  actualPct: number | null
  /** 위임 표식(tags 에 agent). */
  delegated: boolean
  /** 이 항목에 approved 주문이 있다(D26). */
  hasApprovedOrder: boolean
  preds: PredsState
}
export type OrderFacts = {
  status: AgentOrderStatus
  designState: DesignState | null
  /** toClaimScope 로 정규화한 값(빈 값은 legacy). */
  claimScope: ClaimScope
  runner: string | null
  runnerSeenAt: string | null
  lastHeartbeatAt: string | null
  heartbeatPhase: string | null
  heartbeatAgent: string | null
  claimedBy: string | null
  claimedByUserId: string | null
}

/** D26 — 이미 진행된 항목(단계 ip 이상·실적 100·approved 주문). 발행·claim 관문·판단 3행·화면 8·10행이 같은 식이다(L6). */
export function alreadyProgressed(i: Pick<ItemFacts, 'stage' | 'actualPct' | 'hasApprovedOrder'>): boolean {
  return stageAtOrPastIp(i.stage) || (typeof i.actualPct === 'number' && i.actualPct >= 100) || i.hasApprovedOrder
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN)

/**
 * 5.3 2행의 "워커가 살아 있음" — last_heartbeat_at 기준. 질문(blocked)은 2 TICK 까지(Y12), 그 밖은 좌석 ACTIVE 와 같은
 * 5분이다. 마지막 phase 가 대기(wait_review·wait_pred)면 워커가 멈추며 남긴 신호라 살아 있지 않다.
 */
export function workerAlive(o: Pick<OrderFacts, 'lastHeartbeatAt' | 'heartbeatPhase'>, nowMs: number): boolean {
  const t = ms(o.lastHeartbeatAt)
  if (Number.isNaN(t)) return false
  if (o.heartbeatPhase !== null && WAIT_PHASES.has(o.heartbeatPhase)) return false
  return nowMs - t <= (o.heartbeatPhase === 'blocked' ? BLOCKED_MAX_AGE_MS : STALE_MS)
}

/** D25 도는 PC 조건 — runner 가 없거나, 호출자와 같은 PC 거나, runner_seen_at 이 30분 넘게 지났다(모르면 지난 것으로 본다). */
export function runnerFree(o: Pick<OrderFacts, 'runner' | 'runnerSeenAt'>, callerLabel: string | null, nowMs: number): boolean {
  if (o.runner === null) return true
  const caller = pcOfLabel(callerLabel)
  if (caller !== null && pcOfLabel(o.runner) === caller) return true
  const seen = ms(o.runnerSeenAt)
  return Number.isNaN(seen) || nowMs - seen > RUNNER_STALE_MS
}

export type ActionResult = { action: AgentAction; reason: string; depsUnmet: boolean }
const act = (action: AgentAction, reason: string, depsUnmet = false): ActionResult => ({ action, reason, depsUnmet })

/**
 * 5.3 판단 — "지금 이 작업을 어떻게 하나". 위에서부터 처음 맞는 행을 쓴다. 9~12행은 ready 이면서 설계 상태가 없을 때만
 * 닿아 canClaim 과 늘 맞는다(tests/domain/design-gate-model.test.ts 가 도달 상태 전수로 확인한다).
 */
export function nextAgentAction(item: ItemFacts, order: OrderFacts, nowMs: number): ActionResult {
  const s = order.status
  if (s === 'reported' || s === 'approved' || s === 'cancelled') return act('skip', '검수·완료·취소')
  if (s === 'claimed' && (stageAtOrPastIp(item.stage) || workerAlive(order, nowMs))) return act('skip', '구현 중·재작업이거나 워커가 살아 있음')
  if (s === 'ready' && alreadyProgressed(item)) return act('skip', '단계 확인 필요(이미 진행된 항목)')
  if (order.designState === 'review') return act('wait', '설계 검토 대기')
  if (order.designState === 'accepted' && item.stage !== 'dd') return act('skip', '단계 확인 필요(승인된 설계인데 단계가 설계 완료가 아님)')
  if (order.designState === 'accepted' && item.preds !== 'met') return act('wait', '선행 대기')
  if (order.designState === 'accepted') return act('build', '승인·확정된 설계')
  if (s === 'claimed') {
    if (item.stage !== 'ds' && item.stage !== 'dd') return act('skip', '단계 확인 필요')
    if (order.claimScope === 'design') return item.preds === 'blocked' ? act('wait', '선행 대기') : act('design', '설계만(이어 감)')
    if (order.claimScope === 'full' || order.claimScope === 'legacy') {
      if ((item.stage === 'dd' && item.preds !== 'met') || item.preds === 'blocked') return act('wait', '선행 대기')
      return act('full', '처음부터 끝까지(이어 감)', item.preds !== 'met')
    }
    return act('skip', '구현(build) 범위인데 설계가 승인되지 않음')
  }
  if (item.mode === 'human') return act('skip', '사람 설계 대기')
  if (item.preds === 'blocked') return act('wait', '선행 대기')
  if (item.mode === 'review') return act('design', '설계만')
  return act('full', '처음부터 끝까지', item.preds !== 'met')
}

export type MineRequest = {
  userId: string
  /** 요청 라벨(PC 판정) — dflow.sh 의 agent_id_default 또는 watcher 라벨. */
  label: string | null
  /** 팀장의 요청이면 claimed 주문에도 목록 거르기와 팀원 라벨을 요구한다(Y9). */
  lead: boolean
  /** 목록 거르기(프로젝트 바인딩·담당자·WP·태그)를 통과했는가 — 라우트가 계산한다. */
  filtersPass: boolean
}

/** 5.3 mine — ready 는 목록 거르기, claimed 는 같은 신원 ∧ runnerFree(build-start 원자 조건과 같은 식). */
export function isMine(
  order: Pick<OrderFacts, 'status' | 'claimedBy' | 'claimedByUserId' | 'runner' | 'runnerSeenAt'>, req: MineRequest, nowMs: number,
): boolean {
  if (order.status === 'ready') return req.filtersPass
  if (order.status !== 'claimed' || order.claimedByUserId !== req.userId) return false
  if (req.lead && (!req.filtersPass || !isWorkerLabel(order.claimedBy))) return false
  return runnerFree(order, req.label, nowMs)
}

export type GateCode = 'design_gate' | 'design_not_accepted' | 'runner_active' | 'dependency_not_met'
export type GateRefusal = { status: 403 | 409; code: GateCode; message: string; reason?: string }
const refuse = (status: 403 | 409, code: GateCode, message: string, reason?: string): GateRefusal =>
  ({ status, code, message, ...(reason ? { reason } : {}) })

/** 5.2 claim 관문. designFirst 는 요청의 design_first(full·legacy 에서만 뜻이 있다). */
export function canClaim(item: ItemFacts, designState: DesignState | null, scope: ClaimScope, designFirst: boolean): GateRefusal | null {
  if (alreadyProgressed(item)) {
    return refuse(409, 'design_gate', '이미 진행된 작업입니다(단계 작업 중 이상·실적 100·승인된 주문) — 단계를 되돌리거나 「재작업」을 쓰세요.')
  }
  let df = designFirst
  if (scope === 'full' || scope === 'legacy') {
    if (item.mode !== 'auto' || designState !== null) {
      return refuse(409, 'design_gate', '완전자동 작업이 아니거나 설계 상태가 있습니다 — 서버 판단(action)을 따르세요.')
    }
  } else if (scope === 'design') {
    if (item.mode === 'human' || designState !== null) {
      return refuse(409, 'design_gate', '설계만 할 수 있는 작업이 아닙니다(구현자동이거나 설계 상태가 있음).')
    }
    df = item.preds !== 'met'
  } else {
    if (item.mode !== 'human' || designState !== 'accepted' || item.stage !== 'dd') {
      return refuse(409, 'design_not_accepted', '확정된 사람 설계가 없습니다 — 「설계 확정」을 먼저 누르세요.')
    }
    df = false
  }
  if (item.preds === 'met') return null
  if (!df) return refuse(403, 'dependency_not_met', '선행 작업이 끝나지 않았습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).')
  if (item.preds === 'blocked') {
    return refuse(403, 'dependency_not_met', '설계 선행은 미충족 선행이 모두 설계 완료(dd)·작업 중(ip)일 때만 할 수 있습니다.', 'design_first_too_early')
  }
  return null
}

/** 5.2 build-start 관문. 검사 순서 runner → 설계 → 선행(P4). 취소된 주문은 라우트가 먼저 409 cancelled 로 돌려준다. */
export function canBuildStart(
  item: ItemFacts, order: OrderFacts, scope: BuildScope, callerLabel: string | null, nowMs: number,
): GateRefusal | null {
  if (order.status !== 'claimed') return refuse(409, 'design_gate', `구현을 시작할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
  if (!runnerFree(order, callerLabel, nowMs)) return refuse(409, 'runner_active', `다른 PC 가 이 작업을 돌리는 중입니다(${order.runner}).`)
  const ge = stageAtOrPastIp(item.stage)
  const eff: BuildScope = scope === 'legacy' && !ge ? 'full' : scope
  const ds = order.designState
  if (eff === 'full') {
    const scopeOk = order.claimScope === 'full' || order.claimScope === 'legacy'
    if (item.mode !== 'auto' || ds !== null || !scopeOk) {
      return refuse(409, 'design_gate', '처음부터 끝까지(full)로 구현을 시작할 수 없는 작업입니다 — 서버 claim_scope 를 따르세요.')
    }
    if (!ge && item.stage !== 'ds' && item.stage !== 'dd') return refuse(409, 'design_gate', '설계 단계(ds·dd)가 아닌 주문입니다.')
  } else if (eff === 'build') {
    if (ds !== 'accepted') return refuse(409, 'design_not_accepted', '승인·확정된 설계가 없습니다 — 「설계 승인」·「설계 확정」을 먼저 누르세요.')
    if (!ge && item.stage !== 'dd') return refuse(409, 'design_gate', '설계 완료(dd) 단계가 아닙니다.')
  } else if (eff === 'rework') {
    const approved = ds === 'accepted' || (item.mode === 'auto' && ds === null)
    if (item.stage !== 'ip' || !approved) {
      return refuse(409, 'design_gate', '재작업을 시작할 수 없는 상태입니다(단계가 작업 중이 아니거나 승인된 설계가 없음).')
    }
  } else if (ds === 'review') {
    return refuse(409, 'design_gate', '설계 검토 대기 중인 작업입니다.')
  }
  if (!ge && eff !== 'rework' && item.preds !== 'met') {
    return refuse(403, 'dependency_not_met', '선행 작업이 끝나지 않아 구현을 시작할 수 없습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).')
  }
  return null
}

/**
 * 완료 보고 관문 — 설계 검토 대기면 거부(W23), 리프는 단계 ip 에서만(Y2), runner 가 다른 PC 면 거부(Y1 — 30분이 지나도
 * 넘겨받지 않는다: 넘겨받기는 heartbeat·build-start 몫), 호출 라벨이 아닌 세션이 살아 있으면 거부(P16).
 * item 이 null 이거나 리프가 아니면(지워진 항목·부모) 단계는 보지 않는다.
 */
export function canReportCompletion(
  item: { stage: string | null; isLeaf: boolean } | null,
  order: Pick<OrderFacts, 'designState' | 'runner' | 'heartbeatAgent' | 'lastHeartbeatAt' | 'heartbeatPhase'>,
  callerLabel: string | null, nowMs: number,
): GateRefusal | null {
  if (order.designState === 'review') return refuse(409, 'design_gate', '설계 검토 대기 중에는 완료를 보고할 수 없습니다.')
  if (item !== null && item.isLeaf && item.stage !== 'ip') {
    return refuse(409, 'design_gate', `완료 보고는 작업 중(ip) 단계에서만 받습니다(현재: ${item.stage ?? '없음'}).`)
  }
  if (order.runner !== null && pcOfLabel(order.runner) !== pcOfLabel(callerLabel)) {
    return refuse(409, 'runner_active', `이 작업은 다른 PC(${order.runner})가 돌리고 있습니다 — 완료 보고는 도는 PC 에서만 받습니다.`)
  }
  if (order.heartbeatAgent !== null && order.heartbeatAgent !== callerLabel && workerAlive(order, nowMs)) {
    return refuse(409, 'runner_active', `다른 세션(${order.heartbeatAgent})이 이 작업을 돌리고 있습니다 — 그 세션이 끝난 뒤 보고하세요.`)
  }
  return null
}

/** D13 — 설계 상태가 있거나, 설계만 하던 주문(claim_scope design)이 ds·dd 에 있으면 반납하지 않는다(웹의 「중단」을 쓴다). */
export function canRelease(item: { stage: string | null } | null, order: Pick<OrderFacts, 'designState' | 'claimScope'>): GateRefusal | null {
  if (order.designState !== null) return refuse(409, 'design_gate', '설계 상태가 있는 작업은 반납하지 않습니다 — 웹에서 「중단」을 쓰세요.')
  if (order.claimScope === 'design' && item !== null && (item.stage === 'ds' || item.stage === 'dd')) {
    return refuse(409, 'design_gate', '설계만 하던 작업은 반납하지 않습니다 — 웹에서 「중단」을 쓰세요.')
  }
  return null
}

/** 4.1 design_done — claimed ∧ 단계 ip 미만. 부모·지워진 항목은 RPC 가 단계·실적만 건너뛴다. */
export function canDesignDone(item: { stage: string | null } | null, order: Pick<OrderFacts, 'status'>): GateRefusal | null {
  if (order.status !== 'claimed') return refuse(409, 'design_gate', `설계 완료를 기록할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
  if (item !== null && stageAtOrPastIp(item.stage)) return refuse(409, 'design_gate', '구현이 시작된 작업은 설계 완료로 되돌릴 수 없습니다.')
  return null
}

/**
 * 4.1 설계 방식 변경 — 설계 상태가 없고 claimed·reported·approved 주문이 없을 때만. 막히면 사람이 할 일을 담은 사유를 낸다.
 * 검사 순서(잠금 조건의 합집합은 그대로다, 문구만 갈린다):
 * ① reported·approved 를 가장 먼저 본다 — 사실만 말하고 고칠 길은 권하지 않는다. 위임 해제(setDelegationAndMode
 *    delegated:false)는 ready·claimed 만 취소할 뿐 reported·approved 주문은 그대로 두고, 「설계 되돌리기」(RPC 가
 *    ready·claimed 만 받는다, 0108:204)도 「중단」(claimed 만 받는다)도 이 상태에는 안 통하기 때문이다.
 * ② 설계 상태가 있으면(=①이 아니었다는 뜻, 즉 reported·approved 는 없다) 위임 해제를 권한다 — 이 갈래에 남은 주문은
 *    ready 나 claimed 뿐이라 위임 해제가 항상 치운다. 「설계 되돌리기」는 대신 권하지 않는다 — human·claimed 조합만
 *    이 잠금을 실제로 풀고(order 가 ready 로, design_state 가 null 로), review·auto 는 design_state 를 review 로
 *    옮길 뿐이라 잠금이 그대로 남기 때문이다(designButtons 의 reopen 이 이 두 갈래 모두에서 뜰 수 있어 버튼 자체는
 *    안 가린다). 「중단」도 권하지 않는다 — 관리자·서브트리 관리자만 쓸 수 있는데, 이 문구는 담당자 본인도 본다.
 * ③ claimed 단독(설계 상태 없이 구현 중)도 같은 이유로 위임 해제를 권한다 — 남은 주문이 claimed 뿐이라 역시
 *    위임 해제가 항상 치운다.
 */
export function designModeChangeBlock(p: { designState: DesignState | null; orderStatuses: readonly string[] }): string | null {
  if (p.orderStatuses.some(s => s === 'reported' || s === 'approved')) return '완료 보고·승인된 주문이 있어 방식을 바꿀 수 없습니다.'
  if (p.designState !== null) return '설계가 확정·검토 중이라 방식을 바꿀 수 없습니다 — 바꾸려면 위임을 해제해 주문을 취소한 뒤 다시 위임하세요.'
  if (p.orderStatuses.includes('claimed')) return '에이전트가 작업 중이라 방식을 바꿀 수 없습니다 — 바꾸려면 위임을 해제해 주문을 취소한 뒤 다시 위임하세요.'
  return null
}

export type DesignButton = 'accept' | 'confirm' | 'reopen'
export type ScreenOrder = Pick<OrderFacts, 'status' | 'designState' | 'runner' | 'lastHeartbeatAt' | 'heartbeatPhase'> & { designNote: string | null }
const HUMAN_DRAFT_STAGES: ReadonlySet<string | null> = new Set([null, 'as', 'ds'])

/** 7절 버튼(서버 조건은 4.1 과 같다). active = 활성 주문(ready·claimed·reported, 0077 로 항목당 하나). */
export function designButtons(item: ItemFacts, active: Pick<ScreenOrder, 'status' | 'designState'> | null): DesignButton[] {
  if (active === null) return []
  const out: DesignButton[] = []
  if (active.status === 'claimed' && active.designState === 'review' && item.stage === 'dd') out.push('accept')
  if (active.status === 'ready' && item.mode === 'human' && item.delegated && HUMAN_DRAFT_STAGES.has(item.stage)
    && active.designState === null && !alreadyProgressed(item)) out.push('confirm')
  // design_reopen RPC 는 주문 status 가 ready·claimed 일 때만 받는다(0108) — reported·approved 에도 버튼을 보이면
  // 누를 때마다 conflict 만 돌아온다(부모 항목처럼 stage 가 dd 에 얼어 있는데 주문이 reported 로 넘어간 경우 등).
  if ((active.status === 'ready' || active.status === 'claimed') && active.designState === 'accepted' && item.stage === 'dd') out.push('reopen')
  return out
}

export type DesignScreenRow = { row: number; label: string; note: string | null; hint: string | null; buttons: DesignButton[] }

/**
 * 3절 화면 판정 — 위에서부터 처음 맞는 행, 없으면 null(호출부가 지금의 단계 문구를 그대로 보인다). 좌석은 BLOCKED·신선한
 * heartbeat(ACTIVE)를 먼저 보고 그다음 이 판정을 본다. 12행은 L14 로 더한 「선행 대기(설계 중 멈춤)」다.
 */
export function designScreen(p: {
  item: ItemFacts; active: ScreenOrder | null; lastReview: 'approve' | 'reject' | null; nowMs: number
}): DesignScreenRow | null {
  const { item, active } = p
  const buttons = designButtons(item, active)
  const r = (row: number, label: string, hint: string | null, note: string | null = null): DesignScreenRow => ({ row, label, note, hint, buttons })
  const ds = active?.designState ?? null
  const which = item.mode === 'human' ? '확정' : '승인'
  if (active?.status === 'claimed' && ds === 'review') {
    return r(1, '설계 검토 대기', 'agent 브랜치의 <TASKS>/<TSK>/design.md 를 검토하고, 고쳤으면 push 한 뒤 「설계 승인」을 누르세요.', active.designNote)
  }
  if (ds === 'accepted' && item.stage === 'dd' && item.preds !== 'met') return r(2, `선행 대기(설계 ${which}됨)`, null)
  if (ds === 'accepted' && item.stage === 'dd') {
    const who = active?.runner ? ` · ${active.runner} 가 도는 중` : ''
    return r(3, `구현 대기(설계 ${which}됨)${who}`, '팀장이 떠 있으면 다음 TICK(기본 30분) 안에 구현을 시작합니다.')
  }
  const alive = active !== null && workerAlive(active, p.nowMs)
  if (active?.status === 'claimed' && ds === null && item.stage === 'dd') {
    return r(4, item.preds !== 'met' ? '설계 완료·선행 대기' : '설계 완료·구현 대기', null)
  }
  if (active?.status === 'claimed' && ds === null && item.stage === 'ds' && item.preds === 'blocked' && !alive) {
    return r(12, '선행 대기(설계 중 멈춤)', '선행 작업이 끝나면 팀장이 이어 갑니다.')
  }
  if (active?.status === 'claimed' && item.stage === 'ip' && p.lastReview === 'reject' && !alive) {
    return r(5, '재작업 대기', '사람이 /dflow-dev 로 재작업을 돌립니다(팀장은 가져가지 않습니다).')
  }
  const humanDraft = item.mode === 'human' && HUMAN_DRAFT_STAGES.has(item.stage) && ds === null && !alreadyProgressed(item)
  if (humanDraft && item.delegated && active?.status === 'ready') {
    return r(6, '사람 설계 대기', '개발 브랜치의 <TASKS>/<TSK>/design.md 에 필수 5개 절을 모두 쓰고 push 한 뒤 「설계 확정」을 누르세요.', active.designNote)
  }
  if (humanDraft) return r(7, '사람 설계 대기(위임 안 됨)', '위임 표식을 달고(프로젝트의 에이전트 위임이 켜져 있어야 합니다) 확정하세요.')
  if (item.delegated && active?.status === 'ready' && alreadyProgressed(item)) {
    return r(8, '위임 보류(단계가 이미 진행됨)', '위임을 해제하고 단계를 되돌린 뒤 다시 위임하세요.')
  }
  if (item.delegated && active === null && item.hasApprovedOrder && item.stage !== 'xx') {
    return r(9, '위임 보류(승인된 주문 있음)', '「재작업」을 쓰세요.')
  }
  if (item.delegated && active === null && !item.hasApprovedOrder && (stageAtOrPastIp(item.stage) || item.actualPct === 100)) {
    return r(10, '위임 보류(단계가 이미 진행됨)', '위임 표식을 떼고 단계를 되돌린 뒤 다시 위임하세요(표식이 있는 동안은 단계 변경이 잠깁니다).')
  }
  if (item.mode === 'review' && active?.status === 'ready' && ds === null && item.preds === 'blocked') return r(11, '선행 대기', null)
  return null
}

/** Y13 — 승인·확정된 설계로 구현 중이면 agent 브랜치 push 금지를 알린다. */
export function designPushWarning(item: Pick<ItemFacts, 'stage'>, active: Pick<ScreenOrder, 'status' | 'designState'> | null): string | null {
  if (active?.status === 'claimed' && active.designState === 'accepted' && stageAtOrPastIp(item.stage)) {
    return '구현 중에는 agent 브랜치에 push 하지 마세요 — 워커의 마감 push 가 충돌합니다. 고칠 것은 완료 보고 뒤 반려로 알리세요.'
  }
  return null
}

const WP_RE = /^([^/\s]+\/)?WP-([0-9]+)$/
/** "WP-02,dict/WP-3" → ['WP-2','dict/WP-3'](번호 앞 0 을 뗀다, poll.sh 와 같다). 빈 값은 null, 형식 오류는 'invalid'. */
export function parseWpList(raw: string | null): string[] | null | 'invalid' {
  const parts = (raw ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
  if (parts.length === 0) return null
  const out: string[] = []
  for (const p of parts) {
    const m = WP_RE.exec(p)
    if (!m) return 'invalid'
    out.push(`${m[1] ?? ''}WP-${String(Number.parseInt(m[2], 10))}`)
  }
  return out
}

/** 목록 거르기(poll.sh filter_ok 와 같은 규칙) — 태그가 있어야 하고, WP 는 external_ref 마지막 칸의 TSK 첫 번호로 가린다. */
export function listFilterPass(
  item: { tags: readonly string[] | null; externalRef: string | null },
  f: { requireTag: string | null; wp: readonly string[] | null },
): boolean {
  if (f.requireTag !== null && !(item.tags ?? []).includes(f.requireTag)) return false
  if (f.wp === null) return true
  const ref = item.externalRef ?? ''
  const last = ref.split('/').pop() ?? ''
  const m = /^TSK-([0-9]+)-/.exec(last)
  if (!m) return false
  const n = String(Number.parseInt(m[1], 10))
  const mod = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/')) : ''
  return f.wp.includes(`WP-${n}`) || (mod !== '' && f.wp.includes(`${mod}/WP-${n}`))
}
