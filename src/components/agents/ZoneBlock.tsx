// src/components/agents/ZoneBlock.tsx
'use client'
import type { Zone } from '@/lib/domain/seatmap'
import { SeatCard } from './Seat'
import type { SeatOpHandler } from './SeatOpsBar'
import css from './seatmap.module.css'

function summary(z: Zone): string {
  const parts: string[] = []
  if (z.summary.work) parts.push(`${z.summary.work} 진행`)
  if (z.summary.wait) parts.push(`${z.summary.wait} 승인 대기`)
  if (z.summary.ready) parts.push(`${z.summary.ready} 빈자리`)
  return parts.join(' · ')
}

/** 진행 중·승인 대기 좌석이 하나도 없는 구역 — 층 카드가 아이콘으로 접는다. */
export function isEmptyZone(z: Zone): boolean {
  return z.summary.work === 0 && z.summary.wait === 0
}

export function ZoneBlock({ zone, selectedId, nowMs, busyOrderId, onSelect, onOp, onFold }: {
  zone: Zone; selectedId: string | null; nowMs: number
  /** op 가 서버에 가 있는 좌석 하나 — 그 좌석의 결재 바만 잠근다. */
  busyOrderId: string | null
  onSelect: (orderId: string) => void
  onOp: SeatOpHandler
  /** 있으면 "접기" 버튼을 그린다 — 아이콘으로 접혔다 펼쳐진 빈 구역만 넘긴다. */
  onFold?: () => void
}) {
  // 머지 완료(최근 7일)는 평면도에 그리지 않는다 — 책상이 승인분으로 메워지면 지금 돌고 있는 것이 안 보인다.
  // 그 좌석의 승인 취소·재작업 요청은 상태 레인 보기의 "빈자리 · 완료" 레인에서 한다.
  const seats = zone.seats.filter(s => s.state !== 'DONE')
  return (
    <div className={css.zone}>
      <div className={css.zoneHead}>
        <span className={css.zoneCode}>{zone.code}</span>
        <span className={css.zoneName}>{zone.name}</span>
        <span className={css.zoneSum}>{summary(zone)}</span>
        {onFold && <button type="button" className={css.zoneFold} aria-label="구역 접기" onClick={onFold}>접기</button>}
      </div>
      <div className={css.block}>
        {seats.map((s, i) => (
          <SeatCard key={s.orderId} seat={s} side={i % 2 === 0 ? 'left' : 'right'} selected={s.orderId === selectedId}
            nowMs={nowMs} busy={busyOrderId === s.orderId} onSelect={onSelect} onOp={onOp} />
        ))}
      </div>
    </div>
  )
}
