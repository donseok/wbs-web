// src/components/agents/FloorCard.tsx
'use client'
import { useState } from 'react'
import type { Floor, Zone } from '@/lib/domain/seatmap'
import { ZoneBlock } from './ZoneBlock'
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

export function FloorCard({ floor, selectedId, nowMs, busyOrderId, withDone = false, onSelect, onOp }: {
  floor: Floor; selectedId: string | null; nowMs: number
  /** op 가 서버에 가 있는 좌석 하나. */
  busyOrderId: string | null
  /** 머지 완료(최근 7일) 좌석도 평면도에 그린다 — 상단 '완료 포함' 토글. */
  withDone?: boolean
  /** null = 선택 해제. 구역을 접으면 그 안의 선택을 푼다 — 선택이 남아 있으면 구역이 다시 펼쳐져 접히지 않던 버그(2026-09-14). */
  onSelect: (orderId: string | null) => void
  onOp: SeatOpHandler
}) {
  // 모든 구역은 기본 펼침이다(folded 에 든 것만 접힘) — 빈 구역도 책상을 그린다(2026-09-19, 모두 펼치기가 기본).
  // 선택된 좌석이 든 구역은 접혀 있어도 펼친다.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const w = floor.watchers
  const watchLabel = w.length === 0 ? '감시 없음'
    : w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${x.untilLabel ? ` ~${x.untilLabel}` : ''}`).join(' · ')
  const shown: Zone[] = [], icons: Zone[] = []
  for (const z of floor.zones) {
    const holdsSelected = selectedId != null && z.seats.some(s => s.orderId === selectedId)
    const collapsed = folded.has(z.key)
    if (collapsed && !holdsSelected) icons.push(z)
    else shown.push(z)
  }
  const without = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); next.delete(key); return next }
  const holds = (z: Zone) => selectedId != null && z.seats.some(s => s.orderId === selectedId)
  const expand = (z: Zone) => setFolded(prev => without(prev, z.key))
  const fold = (z: Zone) => {
    if (holds(z)) onSelect(null)
    setFolded(prev => new Set(prev).add(z.key))
  }
  const expandAll = () => setFolded(new Set())
  const foldAll = () => {
    if (floor.zones.some(holds)) onSelect(null)
    setFolded(new Set(floor.zones.map(z => z.key)))
  }
  return (
    <section className={css.floor} aria-label={floor.name}>
      <header className={css.floorHead}>
        {/* seatCount 는 승인분을 뺀 수다 — '완료 포함'일 때는 그 수를 숨기지 않고 따로 붙인다. */}
        <h2>{floor.name}<small>{floor.zones.length}구역 · {floor.seatCount}석{withDone && floor.doneCount > 0 ? ` · 완료 ${floor.doneCount}` : ''}</small></h2>
        <div className={css.floorTools} role="group" aria-label="구역 접기">
          <button type="button" className={css.zoneFold} data-floor-expand-all onClick={expandAll}>모두 펼치기</button>
          <button type="button" className={css.zoneFold} data-floor-fold-all onClick={foldAll}>모두 접기</button>
        </div>
        <span className={`${css.watch} ${w.length ? css.watchOn : ''}`} title={watchLabel}>{w.length ? `감시 중 · ${watchLabel}` : '감시 없음'}</span>
      </header>
      <div className={css.zones}>
        {shown.map(z => <ZoneBlock key={z.key} zone={z} selectedId={selectedId} nowMs={nowMs} busyOrderId={busyOrderId} withDone={withDone} onSelect={onSelect} onOp={onOp} onFold={() => fold(z)} />)}
        {icons.length > 0 && (
          <div className={css.zoneIcons} role="group" aria-label="접힌 구역">
            {icons.map(z => {
              const kind = zoneKind(z)
              // 빈 구역의 숫자는 빈자리 수다 — 머지 완료 좌석은 기본적으로 평면도에 그리지 않으므로 세지 않는다.
              // ('완료 포함'을 켜면 승인분이 있는 구역은 애초에 접히지 않아 이 자리에 오지 않는다.)
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
