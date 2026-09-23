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

export const STATE_LABEL: Record<SeatState, string> = {
  ACTIVE: '업무 중', STALE: '무응답', OFFLINE: '끊김', BLOCKED: '결정 대기', REJECTED: '반려 · 재작업',
  WAIT: '승인 대기', READY: '빈자리', DONE: '머지 완료',
}

export function seatMetaLine(seat: Seat, nowMs: number): string {
  const who = seat.agent ?? '—'
  switch (seat.state) {
    case 'ACTIVE': case 'REJECTED': return `${who} · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'STALE': return `${who} · 무응답 ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'OFFLINE': return `${seat.phase} 에서 끊김 · ${ageLabel(seat.lastSignalAt, nowMs)}`
    case 'BLOCKED': return `${who} · 결정 대기`
    case 'WAIT': return '승인 대기'
    case 'READY': return seat.waitReason?.label ?? '미착수' // 짧은 라벨만 — 전문은 상세 패널(착수 대기 사유 스펙 §4)
    default: return '머지 완료'
  }
}

/** 상태 표지 — 아이콘 I1. 옛 판의 글자 배지(`!` · `?` · "끊김")를 대신한다. */
const MARK: Partial<Record<SeatState, () => React.JSX.Element>> = {
  STALE: IconStale, OFFLINE: IconOffline, BLOCKED: IconBlocked, WAIT: IconWait, REJECTED: IconRejected, DONE: IconDone,
}
const HAS_BAR: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED', 'OFFLINE']

export function SeatMark({ state, anim }: { state: SeatState; anim?: AnimName }) {
  // 선행 대기는 상태가 READY 라 상태 표로는 못 가른다 — 좌석 그림(waiting)을 따라 표지를 단다.
  if (anim === 'waiting') {
    return <span className={css.mark} data-mark="waiting" title="선행 대기"><IconDependency /></span>
  }
  const Icon = MARK[state]
  if (!Icon) return null
  return <span className={css.mark} data-mark={state} title={STATE_LABEL[state]}><Icon /></span>
}

/** 캐릭터 머리 위 — 보고·한마디가 있으면 말풍선, 없으면 단계 말풍선(에이전트 보기와 같은 규칙). */
function SeatHead({ seat, nowMs }: { seat: Seat; nowMs: number }) {
  const say = seatSpeech(seat, nowMs, useOfficeChatter())
  return say ? <ChatBubble key={say.text} {...say} className="block w-max max-w-[168px]" /> : <PhaseBadge seat={seat} />
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
          aria-pressed={selected} aria-label={`${seat.code} ${seat.name} ${STATE_LABEL[seat.state]}`}
          onClick={() => onSelect(seat.orderId)}
        >
          <span className={css.deskTop}>
            <span className={css.deskId}>{seat.code}</span>
            {owner && <OwnerTag owner={owner} />}
            <DecisionChip count={seat.decisionCount} />
            <SeatMark state={seat.state} anim={seat.anim} />
          </span>
          <span className={css.deskName}>{seat.name}</span>
          <span className={css.deskMeta}>{seatMetaLine(seat, nowMs)}</span>
          {seat.state === 'BLOCKED' && seat.note && <span className={css.note}>{seat.note}</span>}
          {HAS_BAR.includes(seat.state) && <span className={css.bar}><i style={{ width: `${seat.progress}%` }} /></span>}
        </button>
        <SeatOpsBar seat={seat} busy={busy} onOp={onOp} />
      </div>
    </div>
  )
}
