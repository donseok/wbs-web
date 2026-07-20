import type { ComputedItem, WbsRow } from './types'
import { round1 } from './format'
import { computeTree, overallProgress } from './rollup'
import { buildTree, collectLeaves, type TreeNode } from './tree'
import { isBusinessDay } from './dates'
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

/** 임의 날짜의 전체 계획% — computeTree를 해당 날짜로 재실행(주말·공휴일 규칙 재사용).
 *  단일 시점 조회용. 여러 날짜를 평가할 때는 plannedCurve 를 쓸 것(동일 수치, 큰 비용 차). */
export function plannedAt(rows: WbsRow[], date: string, holidays: Set<string>): number {
  return overallProgress(computeTree(rows, date, holidays)).planned
}

/**
 * 계획 곡선 다지점 평가 — dates 각각에 plannedAt 을 부른 것과 결과가 정확히 같다
 * (plannedPct→computeNode→overallProgress 의 라운딩 구조를 그대로 복제 — 동일성은
 * trend.test 의 등가성 속성 테스트가 지킨다). 차이는 비용뿐: plannedAt 재샘플링은
 * 날짜마다 트리 재구축 + 노드×기간 영업일 루프라 O(샘플 × N × 기간일수)인 반면,
 * 여기는 트리 1회 + 축 범위 영업일 누적 인덱스 1회 + 날짜당 O(N) 워크다.
 * (대시보드 fast-follow 2026-07-09: 71행 ~104ms/요청 실측, 600 leaf 외삽 ~1.3s 해소)
 */
export function plannedCurve(rows: WbsRow[], dates: string[], holidays: Set<string>): TrendPoint[] {
  if (dates.length === 0) return []
  const tree = buildTree(rows)

  // 영업일 누적 인덱스 — 계획일·샘플일 전체를 덮는 구간의 날짜별 누적 영업일 수(양끝 포함)
  const bounds: string[] = [...dates]
  for (const r of rows) {
    if (r.plannedStart) bounds.push(r.plannedStart)
    if (r.plannedEnd) bounds.push(r.plannedEnd)
  }
  const rangeLo = bounds.length ? bounds.reduce((a, b) => (a < b ? a : b)) : null
  const rangeHi = bounds.length ? bounds.reduce((a, b) => (a > b ? a : b)) : null
  const cum = new Map<string, number>()
  if (rangeLo !== null && rangeHi !== null) {
    let acc = 0
    for (let d = rangeLo; d <= rangeHi; d = addDaysCal(d, 1)) {
      if (isBusinessDay(d, holidays)) acc++
      cum.set(d, acc)
    }
  }
  // businessDaysBetween(a,b) 동치: 양끝 포함, b<a 는 0 (진입 날짜는 모두 feed 되어 cum 에 존재)
  const bizBetween = (a: string, b: string): number => {
    if (b < a) return 0
    return (cum.get(b) ?? 0) - (cum.get(a) ?? 0) + (isBusinessDay(a, holidays) ? 1 : 0)
  }

  // plannedPct 동치(자기 날짜 기준 계획%) — progress.ts 의 가드·캡·round1 순서 유지
  const ownPlanned = (n: TreeNode, date: string): number => {
    if (!n.plannedStart || !n.plannedEnd) return 0
    if (date < n.plannedStart) return 0
    const total = bizBetween(n.plannedStart, n.plannedEnd)
    if (total === 0) return 0
    const capped = date > n.plannedEnd ? n.plannedEnd : date
    const done = bizBetween(n.plannedStart, capped)
    return Math.min(100, Math.max(0, round1((done / total) * 100)))
  }
  // computeNode 의 rolledPlanned 동치 — 형제 가중(null=1) 평균 + 단계별 round1
  const sibW = (w: number | null) => (w == null ? 1 : w)
  const nodePlanned = (n: TreeNode, date: string): number => {
    if (n.children.length === 0) return ownPlanned(n, date)
    const totalW = n.children.reduce((s, c) => s + sibW(c.weight), 0) || 1
    return round1(n.children.reduce((s, c) => s + sibW(c.weight) * nodePlanned(c, date), 0) / totalW)
  }
  // overallProgress 동치 — 루트 가중치 전부 null 이면 균등
  const allNull = tree.every(r => r.weight == null)
  const eff = (r: TreeNode) => (allNull ? 1 : r.weight ?? 0)
  const totalEff = tree.reduce((s, r) => s + eff(r), 0) || 1
  return dates.map(date => ({
    date,
    pct: round1(tree.reduce((s, r) => s + eff(r) * nodePlanned(r, date), 0) / totalEff),
  }))
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
  const plannedSeries = plannedCurve(rows, [...sampleDates].sort(), holidays)

  // 실적 이력 — 오늘 이후 제외, carry-forward로 오늘까지 연장.
  // '실적선은 항상 보인다' 불변식: 이력이 축 시작 이후에야 시작되면 (축 시작, 0)에서 직선 보간으로
  // 연결하고, 이력이 전혀 없으면 현재 실적으로 (축 시작,0)→(오늘,실적) 선을 합성한다 —
  // 스냅샷 축적 초기(0~1건)에도 점이 아니라 선이 그려지게.
  const snaps = input.snapshots.filter(s => s.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1))
  const actualSeries: TrendPoint[] = snaps.map(s => ({ date: s.date, pct: s.actual }))
  const lastSnap = snaps[snaps.length - 1]
  if (lastSnap && lastSnap.date < today) actualSeries.push({ date: today, pct: lastSnap.actual })
  if (snaps.length) {
    if (snaps[0].date > axisStart) actualSeries.unshift({ date: axisStart, pct: 0 })
  } else if (today > axisStart) {
    const end = today <= axisEnd ? today : axisEnd
    actualSeries.push({ date: axisStart, pct: 0 }, { date: end, pct: overallProgress(items).actual })
  }

  // SPI — 계획 5% 미만 시점 제외(scheduleModel 조기 가드와 동일 원칙)
  const spiSeries: SpiPoint[] = snaps
    .filter(s => s.planned >= 5)
    .map(s => ({ date: s.date, spi: Math.round((s.actual / s.planned) * 100) / 100 }))
  const currentSpi = spiSeries.length ? spiSeries[spiSeries.length - 1].spi : null

  // 주간 velocity — 7일 전 시점 값이 없으면(이력 부족) null
  const nowV = actualAt(snaps, today)
  const prevV = actualAt(snaps, addDaysCal(today, -7))
  const velocityWeek = nowV != null && prevV != null ? round1(nowV - prevV) : null

  return {
    empty: false, axisStart, axisEnd, plannedSeries, actualSeries,
    spiSeries, currentSpi, velocityWeek, hasHistory: snaps.length > 0,
  }
}
