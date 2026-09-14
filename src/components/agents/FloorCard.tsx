// src/components/agents/FloorCard.tsx
'use client'
import { useState } from 'react'
import { Armchair } from 'lucide-react'
import type { Floor, Zone } from '@/lib/domain/seatmap'
import { ZoneBlock, isEmptyZone } from './ZoneBlock'
import css from './seatmap.module.css'

type ZoneKind = 'work' | 'wait' | 'empty'
const KIND_LABEL: Record<ZoneKind, string> = { work: '진행', wait: '승인 대기', empty: '빈자리' }

/** 아이콘으로 접혔을 때의 구분 — 진행 중(work) > 승인 대기(wait) > 빈 구역(empty). */
export function zoneKind(z: Zone): ZoneKind {
  if (z.summary.work > 0) return 'work'
  if (z.summary.wait > 0) return 'wait'
  return 'empty'
}

export function FloorCard({ floor, selectedId, nowMs, onSelect }: {
  floor: Floor; selectedId: string | null; nowMs: number; onSelect: (orderId: string) => void
}) {
  // 빈 구역은 기본 접힘(opened 에 든 것만 펼침), 나머지는 기본 펼침(folded 에 든 것만 접힘).
  // 선택된 좌석이 든 구역은 어느 쪽이든 펼친다.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const w = floor.watchers
  const watchLabel = w.length === 0 ? '감시 없음'
    : w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${x.untilLabel ? ` ~${x.untilLabel}` : ''}`).join(' · ')
  const shown: Zone[] = [], icons: Zone[] = []
  for (const z of floor.zones) {
    const holdsSelected = selectedId != null && z.seats.some(s => s.orderId === selectedId)
    const collapsed = isEmptyZone(z) ? !opened.has(z.key) : folded.has(z.key)
    if (collapsed && !holdsSelected) icons.push(z)
    else shown.push(z)
  }
  const without = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); next.delete(key); return next }
  const expand = (z: Zone) => (isEmptyZone(z) ? setOpened(prev => new Set(prev).add(z.key)) : setFolded(prev => without(prev, z.key)))
  const fold = (z: Zone) => (isEmptyZone(z) ? setOpened(prev => without(prev, z.key)) : setFolded(prev => new Set(prev).add(z.key)))
  return (
    <section className={css.floor} aria-label={floor.name}>
      <header className={css.floorHead}>
        <h2>{floor.name}<small>{floor.zones.length}구역 · {floor.seatCount}석</small></h2>
        <span className={`${css.watch} ${w.length ? css.watchOn : ''}`} title={watchLabel}>{w.length ? `감시 중 · ${watchLabel}` : '감시 없음'}</span>
      </header>
      <div className={css.zones}>
        {shown.map(z => <ZoneBlock key={z.key} zone={z} selectedId={selectedId} nowMs={nowMs} onSelect={onSelect} onFold={() => fold(z)} />)}
        {icons.length > 0 && (
          <div className={css.zoneIcons} role="group" aria-label="접힌 구역">
            {icons.map(z => {
              const kind = zoneKind(z)
              const n = kind === 'work' ? z.summary.work : kind === 'wait' ? z.summary.wait : z.seats.length
              const label = `${z.code} ${z.name} · ${n} ${KIND_LABEL[kind]}`
              return (
                <button key={z.key} type="button" className={css.zoneIcon} data-kind={kind} aria-expanded="false"
                  aria-label={`${label} — 펼치기`} title={label} onClick={() => expand(z)}>
                  <Armchair aria-hidden="true" /><b>{n}</b>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {floor.doneCount > 0 && <p className={css.doneNote}>머지 완료 {floor.doneCount}건(최근 7일)은 접혀 있습니다.</p>}
    </section>
  )
}
