// src/components/agents/FloorCard.tsx
'use client'
import { useState } from 'react'
import type { Floor, Zone } from '@/lib/domain/seatmap'
import { ZoneBlock, isEmptyZone } from './ZoneBlock'
import type { SeatOpHandler } from './SeatOpsBar'
import { IconBlocked, IconFolded, IconWait } from './icons'
import css from './seatmap.module.css'

type ZoneKind = 'work' | 'wait' | 'empty'
const KIND_LABEL: Record<ZoneKind, string> = { work: '진행', wait: '승인 대기', empty: '빈자리' }
/** 접힌 구역을 세 종류로 가른다 — 옛 판은 Armchair 하나로 셋을 다 표현했다(아이콘 I1). */
const KIND_ICON: Record<ZoneKind, () => React.JSX.Element> = { work: IconBlocked, wait: IconWait, empty: IconFolded }

/** 아이콘으로 접혔을 때의 구분 — 진행 중(work) > 승인 대기(wait) > 빈 구역(empty). */
export function zoneKind(z: Zone): ZoneKind {
  if (z.summary.work > 0) return 'work'
  if (z.summary.wait > 0) return 'wait'
  return 'empty'
}

export function FloorCard({ floor, selectedId, nowMs, busyOrderId, onSelect, onOp }: {
  floor: Floor; selectedId: string | null; nowMs: number
  /** op 가 서버에 가 있는 좌석 하나. */
  busyOrderId: string | null
  /** null = 선택 해제. 구역을 접으면 그 안의 선택을 푼다 — 선택이 남아 있으면 구역이 다시 펼쳐져 접히지 않던 버그(2026-09-14). */
  onSelect: (orderId: string | null) => void
  onOp: SeatOpHandler
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
  const holds = (z: Zone) => selectedId != null && z.seats.some(s => s.orderId === selectedId)
  const expand = (z: Zone) => (isEmptyZone(z) ? setOpened(prev => new Set(prev).add(z.key)) : setFolded(prev => without(prev, z.key)))
  const fold = (z: Zone) => {
    if (holds(z)) onSelect(null)
    if (isEmptyZone(z)) setOpened(prev => without(prev, z.key)); else setFolded(prev => new Set(prev).add(z.key))
  }
  const expandAll = () => { setFolded(new Set()); setOpened(new Set(floor.zones.filter(isEmptyZone).map(z => z.key))) }
  const foldAll = () => {
    if (floor.zones.some(holds)) onSelect(null)
    setOpened(new Set()); setFolded(new Set(floor.zones.filter(z => !isEmptyZone(z)).map(z => z.key)))
  }
  return (
    <section className={css.floor} aria-label={floor.name}>
      <header className={css.floorHead}>
        <h2>{floor.name}<small>{floor.zones.length}구역 · {floor.seatCount}석</small></h2>
        <div className={css.floorTools} role="group" aria-label="구역 접기">
          <button type="button" className={css.zoneFold} data-floor-expand-all onClick={expandAll}>모두 펼치기</button>
          <button type="button" className={css.zoneFold} data-floor-fold-all onClick={foldAll}>모두 접기</button>
        </div>
        <span className={`${css.watch} ${w.length ? css.watchOn : ''}`} title={watchLabel}>{w.length ? `감시 중 · ${watchLabel}` : '감시 없음'}</span>
      </header>
      <div className={css.zones}>
        {shown.map(z => <ZoneBlock key={z.key} zone={z} selectedId={selectedId} nowMs={nowMs} busyOrderId={busyOrderId} onSelect={onSelect} onOp={onOp} onFold={() => fold(z)} />)}
        {icons.length > 0 && (
          <div className={css.zoneIcons} role="group" aria-label="접힌 구역">
            {icons.map(z => {
              const kind = zoneKind(z)
              // 빈 구역의 숫자는 빈자리 수다 — 머지 완료 좌석은 평면도에 그리지 않으므로 세지 않는다.
              const n = kind === 'work' ? z.summary.work : kind === 'wait' ? z.summary.wait : z.summary.ready
              const label = `${z.code} ${z.name} · ${n} ${KIND_LABEL[kind]}`
              const Icon = KIND_ICON[kind]
              return (
                <button key={z.key} type="button" className={css.zoneIcon} data-kind={kind} aria-expanded="false"
                  aria-label={`${label} — 펼치기`} title={label} onClick={() => expand(z)}>
                  <Icon /><b>{n}</b>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
