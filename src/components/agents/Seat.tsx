// src/components/agents/Seat.tsx
'use client'
import type { Seat } from '@/lib/domain/seatmap'
import type { SeatState } from '@/lib/domain/seatState'
import { ageLabel } from '@/lib/domain/seatmap'
import { Sprite } from './Sprite'
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

const FLAG: Partial<Record<SeatState, string>> = { STALE: '!', OFFLINE: '끊김', BLOCKED: '?' }
const HAS_BAR: readonly SeatState[] = ['ACTIVE', 'STALE', 'REJECTED', 'BLOCKED', 'OFFLINE']

export function SeatCard({ seat, side, selected, nowMs, onSelect }: {
  seat: Seat; side: 'left' | 'right'; selected: boolean; nowMs: number; onSelect: (orderId: string) => void
}) {
  const flag = FLAG[seat.state]
  return (
    <div className={`${css.seat} ${side === 'left' ? css.seatLeft : css.seatRight}`}>
      <div className={css.chair}><Sprite character={seat.character} anim={seat.anim} /></div>
      <button
        type="button" className={css.desk} data-state={seat.state} data-rejected={seat.rejected ? '1' : undefined}
        aria-pressed={selected} aria-label={`${seat.code} ${seat.name} ${STATE_LABEL[seat.state]}`}
        onClick={() => onSelect(seat.orderId)}
      >
        {flag && <span className={css.flag} data-flag="">{flag}</span>}
        <span className={css.deskId}>{seat.code}</span>
        <span className={css.deskName}>{seat.name}</span>
        <span className={css.deskMeta}>{seatMetaLine(seat, nowMs)}</span>
        {seat.state === 'BLOCKED' && seat.note && <span className={css.note}>{seat.note}</span>}
        {HAS_BAR.includes(seat.state) && <span className={css.bar}><i style={{ width: `${seat.progress}%` }} /></span>}
      </button>
    </div>
  )
}
