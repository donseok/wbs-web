import type { ComputedItem, WbsRow } from './types'
import { computeTree, overallProgress } from './rollup'
import { collectLeaves } from './tree'
import { addDaysCal } from './dashboard'

/** wbs_progress_snapshots 1행 (camelCase, 숫자 변환 완료 상태) */
export interface SnapshotPoint { date: string; actual: number; planned: number }
export interface TrendPoint { date: string; pct: number }
export interface SpiPoint { date: string; spi: number }

export interface TrendModel {
  empty: boolean
  axisStart: string
  axisEnd: string
  plannedSeries: TrendPoint[]
  actualSeries: TrendPoint[]   // carry-forward 적용, 오늘까지만
  spiSeries: SpiPoint[]        // planned ≥ 5 시점만(조기 불안정 가드)
  currentSpi: number | null
  velocityWeek: number | null  // 최근 7일 실적 증분(%p), 이력 부족 시 null
  hasHistory: boolean
}

const EMPTY: TrendModel = {
  empty: true, axisStart: '', axisEnd: '', plannedSeries: [], actualSeries: [],
  spiSeries: [], currentSpi: null, velocityWeek: null, hasHistory: false,
}

/** ComputedItem 트리 → 평탄한 WbsRow[] — computeTree를 다른 날짜로 재실행하기 위한 입력. */
export function flattenRows(items: ComputedItem[]): WbsRow[] {
  const out: WbsRow[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      out.push({
        id: n.id, parentId: n.parentId, level: n.level, code: n.code, sortOrder: n.sortOrder,
        name: n.name, biz: n.biz, deliverable: n.deliverable,
        plannedStart: n.plannedStart, plannedEnd: n.plannedEnd,
        weight: n.weight, actualPct: n.actualPct, owners: n.owners,
      })
      walk(n.children)
    })
  walk(items)
  return out
}

/** 임의 날짜의 전체 계획% — computeTree를 해당 날짜로 재실행(주말·공휴일 규칙 재사용). */
export function plannedAt(rows: WbsRow[], date: string, holidays: Set<string>): number {
  return overallProgress(computeTree(rows, date, holidays)).planned
}

/** carry-forward 조회: date 이전(포함) 마지막 스냅샷의 실적. 없으면 null. */
function actualAt(sorted: SnapshotPoint[], date: string): number | null {
  let v: number | null = null
  for (const s of sorted) {
    if (s.date > date) break
    v = s.actual
  }
  return v
}

export function buildTrend(input: {
  items: ComputedItem[]
  snapshots: SnapshotPoint[]
  holidays: Set<string>
  startDate: string | null
  endDate: string | null
  today: string
}): TrendModel {
  const { items, holidays, startDate, endDate, today } = input

  // 축 — 프로젝트 기간 우선, 없으면 WBS leaf 날짜 min/max
  const leafDates = collectLeaves(items)
    .flatMap(l => [l.plannedStart, l.plannedEnd])
    .filter((d): d is string => d != null)
  const axisStart = startDate ?? (leafDates.length ? leafDates.reduce((a, b) => (a < b ? a : b)) : null)
  const axisEnd = endDate ?? (leafDates.length ? leafDates.reduce((a, b) => (a > b ? a : b)) : null)
  if (!axisStart || !axisEnd || axisStart >= axisEnd) return EMPTY

  // 계획 누적곡선 — 주 단위 샘플 + 종료일 + (구간 내) 오늘
  const rows = flattenRows(items)
  const sampleDates = new Set<string>()
  for (let d = axisStart; d <= axisEnd; d = addDaysCal(d, 7)) sampleDates.add(d)
  sampleDates.add(axisEnd)
  if (today >= axisStart && today <= axisEnd) sampleDates.add(today)
  const plannedSeries = [...sampleDates].sort().map(date => ({ date, pct: plannedAt(rows, date, holidays) }))

  // 실적 이력 — 오늘 이후 제외, carry-forward로 오늘까지 연장
  const snaps = input.snapshots.filter(s => s.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1))
  const actualSeries: TrendPoint[] = snaps.map(s => ({ date: s.date, pct: s.actual }))
  const lastSnap = snaps[snaps.length - 1]
  if (lastSnap && lastSnap.date < today) actualSeries.push({ date: today, pct: lastSnap.actual })

  // SPI — 계획 5% 미만 시점 제외(scheduleModel 조기 가드와 동일 원칙)
  const spiSeries: SpiPoint[] = snaps
    .filter(s => s.planned >= 5)
    .map(s => ({ date: s.date, spi: Math.round((s.actual / s.planned) * 100) / 100 }))
  const currentSpi = spiSeries.length ? spiSeries[spiSeries.length - 1].spi : null

  // 주간 velocity — 7일 전 시점 값이 없으면(이력 부족) null
  const nowV = actualAt(snaps, today)
  const prevV = actualAt(snaps, addDaysCal(today, -7))
  const velocityWeek = nowV != null && prevV != null ? nowV - prevV : null

  return {
    empty: false, axisStart, axisEnd, plannedSeries, actualSeries,
    spiSeries, currentSpi, velocityWeek, hasHistory: snaps.length > 0,
  }
}
