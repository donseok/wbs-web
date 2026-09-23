// 착수 대기 사유 — 순수 함수. ready 주문(빈자리)이 왜 안 시작되는지를 서버가 아는 재료로 판정한다.
// 스펙: docs/superpowers/specs/2026-09-14-office-wait-reason-design.md §1
// 판정 축은 클레임 API(work/[id]/claim)의 거절 조건과 같다 — not_assignee · dependency_not_met. 여기서 다르게 말하면 화면이 거짓말한다.
import { predecessorReached } from './agentWork'
import { STAGE_LABEL_KO, isStageCode } from './stageLabels'

export type WaitReasonKind = 'dependency' | 'agent_off' | 'agents_busy' | 'pickup'
export interface WaitReason { kind: WaitReasonKind; label: string; text: string }

export function stageText(stage: string | null): string {
  if (stage === null) return '단계 없음'
  return isStageCode(stage) ? `${stage}(${STAGE_LABEL_KO[stage]})` : stage
}

export interface PredecessorLike {
  external_ref: string; code: string; name: string; stage: string | null; order_approved: boolean
  /** 선행 충족 세 번째 축(스펙 2026-09-15 §3.7) — 실적 100 이면 충족. 선택 필드: 모르는 호출부는 앞의 두 축으로만 판정한다. */
  actual_pct?: number | null
}
export interface UnmetDepend { ref: string; found: boolean; code?: string; name?: string; stage?: string | null }

/** 미충족 선행 — 면제(waived)·검수 대기(im) 이상·승인된 주문·실적 100 중 하나면 충족(predecessorReached). 프로젝트에 없는 ref 는 미충족(fail-closed, 클레임 게이트와 동일) — 단 면제된 ref 는 조회 전에 충족이다. */
export function unmetDepends(
  depends: string[] | null, byRef: (ref: string) => PredecessorLike | undefined, waived: readonly string[] = [],
): UnmetDepend[] {
  const out: UnmetDepend[] = []
  const w = new Set(waived)
  for (const ref of depends ?? []) {
    if (w.has(ref)) continue
    const p = byRef(ref)
    if (!p) { out.push({ ref, found: false }); continue }
    if (predecessorReached({ stage: p.stage, orderApproved: p.order_approved, actualPct: p.actual_pct })) continue
    out.push({ ref, found: true, code: p.code, name: p.name, stage: p.stage })
  }
  return out
}

export function unmetDependsList(u: UnmetDepend[]): string {
  return u.map(d => d.found ? `${d.code} ${d.name}(현재 ${stageText(d.stage ?? null)})` : `${d.ref}(프로젝트에 없는 항목)`).join(', ')
}

export interface WatcherLike { agent: string; user_id: string | null; slots: number | null; busy: number | null; until_label: string | null }

const isBusy = (w: WatcherLike) => w.slots !== null && (w.busy ?? 0) >= w.slots
const watcherLabel = (w: WatcherLike) => `${w.agent}${w.slots !== null ? ` ${w.busy ?? 0}/${w.slots}` : ''}${w.until_label ? ` ~${w.until_label}` : ''}`

export function deriveWaitReason(args: {
  depends: string[] | null
  predecessorByRef: (ref: string) => PredecessorLike | undefined
  /** 항목 담당자의 로스터 행 — 없으면 null. user_id 가 null 이면 어느 PAT 도 담당자로 인정되지 않는다. */
  assignee: { name: string; user_id: string | null } | null
  /** 이 층을 보는 살아 있는 감시자(project_id null 포함). */
  watchers: WatcherLike[]
  /** 강제 진행으로 면제한 선행 ref(wbs_items.depends_waived). */
  waived?: readonly string[]
}): WaitReason {
  const unmet = unmetDepends(args.depends, args.predecessorByRef, args.waived ?? [])
  if (unmet.length > 0) {
    return {
      kind: 'dependency', label: '선행 대기',
      text: `선행 작업이 아직 끝나지 않았습니다: ${unmetDependsList(unmet)}. 선행이 검수 대기(im) 이상이 되거나, 그 주문이 승인되거나, 실적이 100% 가 돼야 이 작업을 집어갈 수 있습니다.`,
    }
  }
  const a = args.assignee
  const eligible = a ? args.watchers.filter(w => a.user_id !== null && w.user_id === a.user_id) : args.watchers
  if (eligible.length === 0) {
    if (!a) {
      return {
        kind: 'agent_off', label: '에이전트 꺼짐',
        text: '이 프로젝트를 보는 에이전트가 하나도 없습니다. 위임은 됐지만 집어갈 주체가 없어 대기 중입니다. 프로젝트 멤버 누구든 자기 PC 에서 /dflow-team 또는 /dflow-poll 을 켜면 시작됩니다.',
      }
    }
    let text = `담당자 ${a.name} 의 에이전트가 켜져 있지 않습니다. 이 작업은 담당자가 지정돼 있어 ${a.name} 의 에이전트만 집어갈 수 있습니다. ${a.name} 이(가) 자기 PC 에서 /dflow-team 또는 /dflow-poll 을 켜야 시작됩니다.`
    if (args.watchers.length > 0) text += ` 지금 켜진 에이전트 ${args.watchers.length}개(${args.watchers.map(w => w.agent).join(', ')})는 다른 사람 것이라 이 작업을 집어갈 수 없습니다.`
    if (a.user_id === null) text += ' (담당자 계정이 로스터에 연결돼 있지 않아 어느 에이전트도 집어갈 수 없습니다. 멤버 화면에서 계정을 연결하세요.)'
    return { kind: 'agent_off', label: '에이전트 꺼짐', text }
  }
  const free = eligible.filter(w => !isBusy(w))
  if (free.length === 0) {
    return {
      kind: 'agents_busy', label: '에이전트 바쁨',
      text: `에이전트 ${eligible.length}개가 켜져 있지만 모두 다른 작업 중입니다(${eligible.map(watcherLabel).join(', ')}). 자리가 비면 다음 확인 주기에 자동으로 집어갑니다.`,
    }
  }
  return {
    kind: 'pickup', label: '착수 대기',
    text: `집어갈 수 있는 에이전트가 있습니다(${free.map(w => w.agent).join(', ')}). 다음 확인 주기에 착수합니다. 이 상태가 오래 가면 그 에이전트의 로그를 확인하세요.`,
  }
}
