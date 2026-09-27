// src/components/agents/Seat.tsx
'use client'
import type { Seat } from '@/lib/domain/seatmap'
import type { AnimName, SeatState } from '@/lib/domain/seatState'
import { ageLabel } from '@/lib/domain/seatmap'
import { Sprite } from './Sprite'
import { PhaseBadge } from './PhaseBadge'
import { ChatBubble, seatSpeech, useOfficeChatter } from './SeatSpeech'
import { SeatOpsBar, type SeatOpHandler } from './SeatOpsBar'
import { OwnerTag, ownerLabel } from './OwnerTag'
import { DecisionChip } from './DecisionChip'
import { IconBlocked, IconDependency, IconDone, IconOffline, IconRejected, IconStale, IconWait } from './icons'
import css from './seatmap.module.css'
import { stubBadgeText } from '@/lib/domain/forceProgress'

export const STATE_LABEL: Record<SeatState, string> = {
  ACTIVE: '업무 중', STALE: '무응답', OFFLINE: '끊김', BLOCKED: '결정 대기', REJECTED: '반려 · 재작업',
  WAIT: '승인 대기', READY: '빈자리', DONE: '머지 완료',
}

/** 좌석 상태 라벨 — 설계 문구(설계 상태 스펙 3절 화면 판정)가 있으면 그것이 먼저다. 설계 완료·선행 대기(designWait)·
 *  검토 대기(reviewWait)·구현 대기(buildWait)는 WAIT 지만 승인 대기가 아니다(스펙 2026-09-26 §6.4, 설계 상태 스펙 3절 1~3행). */
export const DESIGN_WAIT_LABEL = '선행 대기'
export const REVIEW_WAIT_LABEL = '설계 검토 대기'
export const BUILD_WAIT_LABEL = '구현 대기'
export function seatStateLabel(seat: Pick<Seat, 'state' | 'designWait' | 'reviewWait' | 'buildWait' | 'design'>): string {
  if (seat.design) return seat.design.label
  if (seat.designWait) return DESIGN_WAIT_LABEL
  if (seat.reviewWait) return REVIEW_WAIT_LABEL
  if (seat.buildWait) return BUILD_WAIT_LABEL
  return STATE_LABEL[seat.state]
}

export function seatMetaLine(seat: Seat, nowMs: number): string {
  // 설계 문구가 있으면 그것 — 조립(assembleSeatmap)이 BLOCKED·살아 있는 워커 좌석에는 싣지 않으므로 지금 문구를 가리지 않는다.
  if (seat.design) return seat.design.label
  const who = seat.agent ?? '—'
  switch (seat.state) {
    case 'ACTIVE': case 'REJECTED': return `${who} · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'STALE': return `${who} · 무응답 ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'OFFLINE': return `${seat.phase} 에서 끊김 · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'BLOCKED': return `${who} · 결정 대기`
    case 'WAIT':
      if (seat.designWait) return seat.waitReason?.label ?? DESIGN_WAIT_LABEL
      if (seat.reviewWait) return seat.waitReason?.label ?? REVIEW_WAIT_LABEL
      if (seat.buildWait) return BUILD_WAIT_LABEL
      return '승인 대기'
    case 'READY': return seat.waitReason?.label ?? '미착수' // 짧은 라벨만 — 전문은 상세 패널(착수 대기 사유 스펙 §4)
    default: return '머지 완료'
  }
}

/** 상태 표지 — 아이콘 I1. 옛 판의 글자 배지(`!` · `?` · "끊김")를 대신한다. */
const MARK: Partial<Record<SeatState, () => React.JSX.Element>> = {
  STALE: IconStale, OFFLINE: IconOffline, BLOCKED: IconBlocked, WAIT: IconWait, REJECTED: IconRejected, DONE: IconDone,
}
const HAS_BAR: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED', 'OFFLINE']

export function SeatMark({ state, anim, reviewWait, buildWait }: { state: SeatState; anim?: AnimName; reviewWait?: boolean; buildWait?: boolean }) {
  // 선행 대기·검토 대기·구현 대기는 상태가 READY(또는 designWait/reviewWait/buildWait 인 WAIT)라 상태 표로는 못 가른다 —
  // 좌석 그림(waiting)을 따라 표지를 달되, 사유가 다르면 말도 다르다(설계 상태 스펙 3절 1~3행).
  if (anim === 'waiting') {
    const [reason, title] = reviewWait ? ['design_review', REVIEW_WAIT_LABEL] : buildWait ? ['build_wait', BUILD_WAIT_LABEL] : ['dependency', DESIGN_WAIT_LABEL]
    return <span className={css.mark} data-mark="waiting" data-mark-reason={reason} title={title}><IconDependency /></span>
  }
  const Icon = MARK[state]
  if (!Icon) return null
  return <span className={css.mark} data-mark={state} title={STATE_LABEL[state]}><Icon /></span>
}

/** 캐릭터 머리 위 — 보고·한마디 말풍선만. 단계 태그는 책상 머리 줄의 칩으로 늘 보인다(2026-09-24, 상태 레인과 같은 배치). */
function SeatHead({ seat, nowMs }: { seat: Seat; nowMs: number }) {
  const say = seatSpeech(seat, nowMs, useOfficeChatter())
  return say && <ChatBubble key={say.text} {...say} className="block w-max max-w-[168px]" />
}

export function SeatCard({ seat, side, selected, nowMs, busy, onSelect, onOp }: {
  seat: Seat; side: 'left' | 'right'; selected: boolean; nowMs: number
  /** 이 좌석의 op 가 서버에 가 있는 동안 참 — 결재 바를 잠근다. */
  busy: boolean
  onSelect: (orderId: string) => void
  onOp: SeatOpHandler
}) {
  const owner = ownerLabel(seat)
  return (
    <div className={`${css.seat} ${side === 'left' ? css.seatLeft : css.seatRight}`}>
      <div className={css.chair}>
        <span className={css.phaseSlot}><SeatHead seat={seat} nowMs={nowMs} /></span>
        <Sprite character={seat.character} anim={seat.anim} />
      </div>
      <div className={css.desk} data-state={seat.state} data-rejected={seat.rejected ? '1' : undefined}
        data-selected={selected ? '1' : undefined} data-owner={owner?.kind}>
        <button
          type="button" className={css.deskPick}
          aria-pressed={selected} aria-label={`${seat.code} ${seat.name} ${seatStateLabel(seat)}`}
          onClick={() => onSelect(seat.orderId)}
        >
          <span className={css.deskTop}>
            <span className={css.deskId}>{seat.code}</span>
            <span data-desk-phase=""><PhaseBadge seat={seat} size="chip" /></span>
            {owner && <OwnerTag owner={owner} />}
            <DecisionChip count={seat.decisionCount} />
            <SeatMark state={seat.state} anim={seat.anim} reviewWait={seat.reviewWait} buildWait={seat.buildWait} />
            {(seat.stubPending ?? []).length > 0 && (
              <span className={css.stubBadge} data-stub-badge="" title={(seat.stubPending ?? []).map(s => s.label).join('\n')}>
                {stubBadgeText((seat.stubPending ?? []).length)}
              </span>
            )}
          </span>
          <span className={css.deskName}>{seat.name}</span>
          <span className={css.deskMeta} data-seat-design-label={seat.design ? String(seat.design.row) : undefined}>{seatMetaLine(seat, nowMs)}</span>
          {seat.state === 'BLOCKED' && seat.note && <span className={css.note}>{seat.note}</span>}
          {HAS_BAR.includes(seat.state) && <span className={css.bar}><i style={{ width: `${seat.progress}%` }} /></span>}
        </button>
        <SeatOpsBar seat={seat} busy={busy} onOp={onOp} />
      </div>
    </div>
  )
}
