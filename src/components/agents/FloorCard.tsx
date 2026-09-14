// src/components/agents/FloorCard.tsx
'use client'
import type { Floor } from '@/lib/domain/seatmap'
import { ZoneBlock } from './ZoneBlock'
import css from './seatmap.module.css'

export function FloorCard({ floor, selectedId, nowMs, onSelect }: {
  floor: Floor; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void
}) {
  const w = floor.watchers
  const watchLabel = w.length === 0 ? '감시 없음'
    : w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${x.untilLabel ? ` ~${x.untilLabel}` : ''}`).join(' · ')
  return (
    <section className={css.floor} aria-label={floor.name}>
      <header className={css.floorHead}>
        <h2>{floor.name}<small>{floor.zones.length}구역 · {floor.seatCount}석</small></h2>
        <span className={`${css.watch} ${w.length ? css.watchOn : ''}`} title={watchLabel}>{w.length ? `감시 중 · ${watchLabel}` : '감시 없음'}</span>
      </header>
      <div className={css.zones}>
        {floor.zones.map(z => <ZoneBlock key={z.key} zone={z} selectedId={selectedId} nowMs={nowMs} onSelect={onSelect} />)}
      </div>
      {floor.doneCount > 0 && <p className={css.doneNote}>머지 완료 {floor.doneCount}건(최근 7일)은 접혀 있습니다.</p>}
    </section>
  )
}
