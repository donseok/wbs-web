// src/components/agents/ZoneBlock.tsx
'use client'
import type { Zone } from '@/lib/domain/seatmap'
import { SeatCard } from './Seat'
import css from './seatmap.module.css'

function summary(z: Zone): string {
  const parts: string[] = []
  if (z.summary.work) parts.push(`${z.summary.work} 진행`)
  if (z.summary.wait) parts.push(`${z.summary.wait} 승인 대기`)
  if (z.summary.ready) parts.push(`${z.summary.ready} 빈자리`)
  return parts.join(' · ')
}

export function ZoneBlock({ zone, selectedId, nowMs, onSelect }: {
  zone: Zone; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void
}) {
  return (
    <div className={css.zone}>
      <div className={css.zoneHead}>
        <span className={css.zoneCode}>{zone.code}</span>
        <span className={css.zoneName}>{zone.name}</span>
        <span className={css.zoneSum}>{summary(zone)}</span>
      </div>
      <div className={css.block}>
        {zone.seats.map((s, i) => (
          <SeatCard key={s.orderId} seat={s} side={i % 2 === 0 ? 'left' : 'right'} selected={s.orderId === selectedId} nowMs={nowMs} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
