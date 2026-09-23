// 강제 진행 — 순수 판정(스펙 docs/superpowers/specs/2026-09-23-force-progress-design.md). DB·세션을 모른다.
// 스텁 잔존(F6·F13)의 정의는 여기 하나다. RPC apply_workflow_event(0103)가 같은 조건을 SQL 로 복제하고
// tests/migrations/0103-force-progress.test.ts 가 대조한다.
import { predecessorReached } from './agentWork'

/** 하위 Task 가 이 단계면 스텁이 치워진 것이다. */
export const STUB_DONE_STAGE = 'xx'

export interface StubTaskLike { id: string; stubFor: string; externalRef: string | null; stage: string | null }

/** DB 행이 「스텁 제거·실연결」 하위 Task 인가 — 판별은 stub_for 플래그 하나다(레벨·이름 아님, SUB-ACT 선례). */
export function isStubRow(r: { stub_for?: string | null }): boolean {
  return typeof r.stub_for === 'string' && r.stub_for !== ''
}

/** 스텁이 아직 남은 하위 — stage 가 xx 가 아닌 것(null 포함). */
export function pendingStubs<T extends StubTaskLike>(subTasks: readonly T[]): T[] {
  return subTasks.filter(s => s.stage !== STUB_DONE_STAGE)
}

/** 후행 승인 잠금(F6) = 스텁 잔존(F13). */
export function stubPendingLock(subTasks: readonly StubTaskLike[]): boolean {
  return pendingStubs(subTasks).length > 0
}

export function lastRefSegment(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] || ref
}

export function stubLabel(predRef: string): string {
  return `스텁 잔존: ${lastRefSegment(predRef)} 대체`
}

export function stubBadgeText(count: number): string {
  return count > 1 ? `스텁 잔존 ${count}` : '스텁 잔존'
}

/** 하위 Task 의 external_ref. 마지막 칸이 dflow.sh 작업 폴더 이름이 된다. */
export function stubTaskRef(successorRef: string, predRef: string): string {
  return `${successorRef}.stub.${lastRefSegment(predRef)}`
}

export function stubTaskName(pred: { code: string; name: string }): string {
  return `스텁 제거·실연결: ${pred.code} ${pred.name}`
}

/** F4 — 서버가 볼 수 있는 계약: spec 본문 또는 acceptance 1건 이상. */
export function hasContract(p: { spec: string | null; acceptance: unknown }): boolean {
  if (typeof p.spec === 'string' && p.spec.trim() !== '') return true
  return Array.isArray(p.acceptance) && p.acceptance.length > 0
}

export type WaiveBlock = 'not_in_depends' | 'already_waived' | 'already_reached' | 'no_contract' | 'is_stub_task' | 'not_leaf' | 'no_ref'

export const WAIVE_BLOCK_TEXT: Record<WaiveBlock, string> = {
  not_in_depends: '이 작업의 선행이 아닙니다.',
  already_waived: '이미 강제 진행 중인 선행입니다.',
  already_reached: '선행이 이미 끝났습니다 — 강제 진행할 필요가 없습니다.',
  no_contract: '선행 계약 없음',
  is_stub_task: '스텁 제거 작업의 선행은 강제 진행할 수 없습니다.',
  not_leaf: '하위 항목이 있는 작업은 강제 진행할 수 없습니다.',
  no_ref: 'WBS 업로드로 만든 작업(external_ref 있음)만 강제 진행할 수 있습니다.',
}

/** 면제 가능 판정 — RPC set_dependency_waiver 가 같은 순서로 다시 판정한다(서버가 정본, 이건 버튼 상태용). */
export function waiveBlock(a: {
  successor: { externalRef: string | null; depends: string[] | null; dependsWaived: string[] | null; stubFor: string | null; hasNormalChildren: boolean }
  predRef: string
  pred: { stage: string | null; orderApproved: boolean; actualPct: number | null; spec: string | null; acceptance: unknown } | null
}): WaiveBlock | null {
  const s = a.successor
  if (s.stubFor) return 'is_stub_task'
  if (s.hasNormalChildren) return 'not_leaf'
  if (!s.externalRef) return 'no_ref'
  if (!(s.depends ?? []).includes(a.predRef)) return 'not_in_depends'
  if ((s.dependsWaived ?? []).includes(a.predRef)) return 'already_waived'
  if (a.pred && predecessorReached({ stage: a.pred.stage, orderApproved: a.pred.orderApproved, actualPct: a.pred.actualPct })) return 'already_reached'
  if (!a.pred || !hasContract(a.pred)) return 'no_contract'
  return null
}

export interface BottleneckSettings { minSuccessors: number; minHours: number }
export const DEFAULT_BOTTLENECK: BottleneckSettings = { minSuccessors: 3, minHours: 4 }

export function validateBottleneckSettings(raw: unknown):
  { ok: true; value: BottleneckSettings } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '설정 형식이 올바르지 않습니다.' }
  const r = raw as Record<string, unknown>
  const n = r.minSuccessors, h = r.minHours
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 1000) return { ok: false, error: '후속 건수는 1 이상 정수입니다.' }
  if (!Number.isInteger(h) || (h as number) < 1 || (h as number) > 720) return { ok: false, error: '시간은 1~720 정수입니다.' }
  return { ok: true, value: { minSuccessors: n as number, minHours: h as number } }
}

/** 막힌 시각(근사, 스펙 §3.2·§6-1) = max(ready 주문의 updated_at, 후속 계획 시작일 00:00 KST). */
export function blockedSinceMs(orderUpdatedAt: string, plannedStart: string | null): number {
  const u = Date.parse(orderUpdatedAt)
  const p = plannedStart ? Date.parse(`${plannedStart}T00:00:00+09:00`) : Number.NaN
  if (Number.isNaN(p)) return u
  if (Number.isNaN(u)) return p
  return Math.max(u, p)
}

export interface BlockedSuccessor { itemId: string; unmetRefs: string[]; blockedSinceMs: number }
export interface Bottleneck { predRef: string; successorIds: string[]; hours: number }

export function findBottlenecks(blocked: readonly BlockedSuccessor[], nowMs: number, s: BottleneckSettings): Bottleneck[] {
  const byPred = new Map<string, BlockedSuccessor[]>()
  for (const b of blocked) for (const ref of b.unmetRefs) {
    const l = byPred.get(ref); if (l) l.push(b); else byPred.set(ref, [b])
  }
  const out: Bottleneck[] = []
  for (const [predRef, list] of byPred) {
    if (list.length < s.minSuccessors) continue
    const oldest = Math.min(...list.map(b => b.blockedSinceMs))
    const hours = Math.floor((nowMs - oldest) / 3600_000)
    if (hours < s.minHours) continue
    out.push({ predRef, successorIds: list.map(b => b.itemId), hours })
  }
  return out.sort((a, b) => b.successorIds.length - a.successorIds.length || b.hours - a.hours)
}

export function bottleneckText(b: Bottleneck, predCode: string): string {
  return `선행 ${predCode} 이 후속 ${b.successorIds.length}건을 막고 있습니다(${b.hours}시간째)`
}
