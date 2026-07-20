import { describe, it, expect } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import { buildTrend, plannedAt, plannedCurve, flattenRows, type SnapshotPoint } from '@/lib/domain/trend'

const row = (over: Partial<WbsRow>): WbsRow => ({
  id: over.id ?? Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...over,
})
const TODAY = '2026-02-20'
const items = (rows: WbsRow[]) => computeTree(rows, TODAY, new Set())
const snap = (date: string, actual: number, planned: number): SnapshotPoint => ({ date, actual, planned })

const baseRows = [row({ plannedStart: '2026-01-01', plannedEnd: '2026-04-10', actualPct: 30 })]

describe('plannedAt', () => {
  const rows = flattenRows(items(baseRows))
  it('시작 전 = 0, 종료 후 = 100', () => {
    expect(plannedAt(rows, '2025-12-31', new Set())).toBe(0)
    expect(plannedAt(rows, '2026-05-01', new Set())).toBe(100)
  })
  it('구간 내 단조 비감소, 0 < 중간값 < 100', () => {
    const mid = plannedAt(rows, '2026-02-20', new Set())
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(100)
    expect(plannedAt(rows, '2026-03-20', new Set())).toBeGreaterThanOrEqual(mid)
  })
})

describe('plannedCurve — plannedAt 등가성(성능 최적화의 정확성 계약)', () => {
  // 결정적 시드 PRNG — 무작위 트리에서도 두 경로가 항상 같은 수치를 내야 한다.
  const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const pad = (n: number) => String(n).padStart(2, '0')

  it('무작위 트리 20종 × 주간 샘플 전체에서 plannedAt 재샘플링과 완전 동일', () => {
    for (let t = 0; t < 20; t++) {
      const rnd = lcg(1000 + t)
      const rows: WbsRow[] = []
      let id = 0
      const phases = 1 + Math.floor(rnd() * 3)
      for (let p = 0; p < phases; p++) {
        const pid = `p${id++}`
        rows.push(row({ id: pid, level: 'phase', weight: rnd() < 0.3 ? null : Math.round(rnd() * 50) / 10 }))
        const tasks = 1 + Math.floor(rnd() * 3)
        for (let k = 0; k < tasks; k++) {
          const tid = `t${id++}`
          rows.push(row({ id: tid, parentId: pid, level: 'task', weight: rnd() < 0.3 ? null : Math.round(rnd() * 50) / 10 }))
          const acts = 1 + Math.floor(rnd() * 4)
          for (let a = 0; a < acts; a++) {
            const noDates = rnd() < 0.15 // 날짜 없는 항목(0% 가드 경로)도 섞는다
            const sm = 1 + Math.floor(rnd() * 6)
            const em = sm + Math.floor(rnd() * (7 - sm))
            rows.push(row({
              id: `a${id++}`, parentId: tid, level: 'activity',
              plannedStart: noDates ? null : `2026-${pad(sm)}-${pad(1 + Math.floor(rnd() * 27))}`,
              plannedEnd: noDates ? null : `2026-${pad(em)}-${pad(1 + Math.floor(rnd() * 27))}`,
              weight: rnd() < 0.3 ? null : Math.round(rnd() * 50) / 10,
            }))
          }
        }
      }
      const holidays = new Set(['2026-01-01', '2026-03-02', '2026-05-05'].filter(() => rnd() < 0.7))
      const addDays = (d: string, n: number) => {
        const dt = new Date(`${d}T00:00:00Z`)
        dt.setUTCDate(dt.getUTCDate() + n)
        return dt.toISOString().slice(0, 10)
      }
      const sampled: string[] = []
      for (let d = '2026-01-01'; d <= '2026-07-31'; d = addDays(d, 7)) sampled.push(d)
      const fast = plannedCurve(rows, sampled, holidays)
      const slow = sampled.map(date => ({ date, pct: plannedAt(rows, date, holidays) }))
      expect(fast).toEqual(slow)
    }
  })

  it('빈 rows·빈 dates 경계에서도 동일', () => {
    expect(plannedCurve([], ['2026-01-01'], new Set())).toEqual([{ date: '2026-01-01', pct: plannedAt([], '2026-01-01', new Set()) }])
    expect(plannedCurve([row({})], [], new Set())).toEqual([])
  })
})

describe('buildTrend — 축/빈 상태', () => {
  it('기간도 WBS 날짜도 없으면 empty', () => {
    const m = buildTrend({ items: items([row({})]), snapshots: [], holidays: new Set(), startDate: null, endDate: null, today: TODAY })
    expect(m.empty).toBe(true)
  })
  it('프로젝트 기간 null이면 WBS 날짜 min/max로 축 대체', () => {
    const m = buildTrend({ items: items(baseRows), snapshots: [], holidays: new Set(), startDate: null, endDate: null, today: TODAY })
    expect(m.empty).toBe(false)
    expect(m.axisStart).toBe('2026-01-01'); expect(m.axisEnd).toBe('2026-04-10')
  })
  it('계획 곡선은 시작~종료 전 구간 + 오늘 포함, 마지막 점 100%', () => {
    const m = buildTrend({ items: items(baseRows), snapshots: [], holidays: new Set(), startDate: '2026-01-01', endDate: '2026-04-10', today: TODAY })
    const dates = m.plannedSeries.map(p => p.date)
    expect(dates[0]).toBe('2026-01-01')
    expect(dates[dates.length - 1]).toBe('2026-04-10')
    expect(dates).toContain(TODAY)
    expect([...dates].sort()).toEqual(dates) // 정렬 보장
    expect(m.plannedSeries[m.plannedSeries.length - 1].pct).toBe(100)
  })
})

describe('buildTrend — 실적 이력', () => {
  const mk = (snaps: SnapshotPoint[]) =>
    buildTrend({ items: items(baseRows), snapshots: snaps, holidays: new Set(), startDate: '2026-01-01', endDate: '2026-04-10', today: TODAY })

  it('carry-forward: 마지막 스냅샷 이후 오늘까지 직전 값 유지 + 축 시작(0%)에서 보간 시작', () => {
    const m = mk([snap('2026-02-10', 10, 40), snap('2026-02-17', 20, 50)])
    expect(m.actualSeries).toEqual([
      { date: '2026-01-01', pct: 0 },
      { date: '2026-02-10', pct: 10 }, { date: '2026-02-17', pct: 20 }, { date: TODAY, pct: 20 },
    ])
    expect(m.hasHistory).toBe(true)
  })
  it('첫 스냅샷이 축 시작과 같은 날이면 0% 시작점을 덧붙이지 않는다', () => {
    const m = mk([snap('2026-01-01', 5, 3)])
    expect(m.actualSeries[0]).toEqual({ date: '2026-01-01', pct: 5 })
  })
  it('오늘 이후 스냅샷은 제외(미래 미연장)', () => {
    const m = mk([snap('2026-02-10', 10, 40), snap('2026-03-01', 99, 60)])
    expect(m.actualSeries.every(p => p.date <= TODAY)).toBe(true)
  })
  it('스냅샷 0건: 현재 실적으로 (축시작,0)→(오늘,실적) 합성 — 실적선은 항상 보인다', () => {
    const m = mk([]) // baseRows 실적 30%
    expect(m.actualSeries).toEqual([{ date: '2026-01-01', pct: 0 }, { date: TODAY, pct: 30 }])
    expect(m.hasHistory).toBe(false)
    expect(m.velocityWeek).toBeNull(); expect(m.currentSpi).toBeNull()
  })
  it('스냅샷 0건 + 오늘이 종료 이후면 합성 선의 끝은 축 종료일', () => {
    const m = buildTrend({
      items: items(baseRows), snapshots: [], holidays: new Set(),
      startDate: '2026-01-01', endDate: '2026-02-01', today: TODAY, // TODAY(02-20) > 종료(02-01)
    })
    expect(m.actualSeries[m.actualSeries.length - 1].date).toBe('2026-02-01')
  })
  it('스냅샷 0건 + 오늘이 시작 이전이면 실적선 없음', () => {
    const m = buildTrend({
      items: items(baseRows), snapshots: [], holidays: new Set(),
      startDate: '2026-03-01', endDate: '2026-04-10', today: TODAY, // TODAY(02-20) < 시작(03-01)
    })
    expect(m.actualSeries).toEqual([])
  })
})

describe('buildTrend — SPI / velocity', () => {
  const mk = (snaps: SnapshotPoint[]) =>
    buildTrend({ items: items(baseRows), snapshots: snaps, holidays: new Set(), startDate: '2026-01-01', endDate: '2026-04-10', today: TODAY })

  it('SPI = actual/planned (소수 2자리), planned<5 시점은 제외', () => {
    const m = mk([snap('2026-01-05', 1, 3), snap('2026-02-10', 10, 40), snap('2026-02-17', 20, 50)])
    expect(m.spiSeries).toEqual([
      { date: '2026-02-10', spi: 0.25 }, { date: '2026-02-17', spi: 0.4 },
    ])
    expect(m.currentSpi).toBe(0.4)
  })
  it('velocity = 오늘 값 − 7일 전 값 (carry-forward 기준)', () => {
    const m = mk([snap('2026-02-10', 10, 40), snap('2026-02-17', 20, 50)])
    // weekAgo = 02-13 → carry-forward 10, today = 20 → +10
    expect(m.velocityWeek).toBe(10)
  })
  it('7일 전 시점 이력이 없으면 velocity null', () => {
    const m = mk([snap('2026-02-17', 20, 50)]) // 최초 스냅샷이 weekAgo(02-13)보다 늦음
    expect(m.velocityWeek).toBeNull()
  })
})
