import { describe, it, expect } from 'vitest'
import { buildJourney } from '@/lib/domain/journey'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

const START = '2026-07-01', END = '2026-12-31'
const rows: WbsRow[] = [
  r({ id: 'P1', level: 'phase', name: '1. 준비', weight: 0.2, plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
  r({ id: 'P2', level: 'phase', name: '2. 설계', weight: 0.8, plannedStart: '2026-08-01', plannedEnd: '2026-12-31', sortOrder: 1 }),
  r({ id: 'a', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-31', actualPct: 10 }),
  r({ id: 'kick', parentId: 'P1', name: '착수 보고회', plannedStart: '2026-07-10', plannedEnd: '2026-07-10', sortOrder: 1 }),
  r({ id: 'b', parentId: 'P2', plannedStart: '2026-08-01', plannedEnd: '2026-12-31' }),
]
const opts = { startDate: START, endDate: END, holidays: [] as string[] }

describe('buildJourney — 기간 미설정', () => {
  it('startDate 또는 endDate가 null이면 null을 반환한다 (카드가 EmptyState로 분기)', () => {
    const tree = computeTree(rows, '2026-07-09', new Set())
    expect(buildJourney(tree, { ...opts, startDate: null, today: '2026-07-09' })).toBeNull()
    expect(buildJourney(tree, { ...opts, endDate: null, today: '2026-07-09' })).toBeNull()
  })
})

describe('buildJourney — 곡선', () => {
  const today = '2026-07-09'
  const tree = computeTree(rows, today, new Set())
  const j = buildJourney(tree, { ...opts, today })!

  it('불변식: 곡선의 오늘 지점이 게이지의 planned와 같다', () => {
    expect(j.planned).toBe(overallProgress(tree).planned)
    expect(j.curve.find(p => p.date === today)!.planned).toBe(overallProgress(tree).planned)
  })

  it('종점이 100이다', () => {
    expect(j.terminalPlanned).toBe(100)
    expect(j.curve[j.curve.length - 1].planned).toBe(100)
  })

  it('첫 점이 시작일, 마지막 점이 종료일', () => {
    expect(j.curve[0].date).toBe(START)
    expect(j.curve[j.curve.length - 1].date).toBe(END)
  })

  it('x는 0..1 정규화, 오름차순', () => {
    expect(j.curve[0].x).toBe(0)
    expect(j.curve[j.curve.length - 1].x).toBe(1)
    j.curve.forEach(p => { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1) })
    for (let i = 1; i < j.curve.length; i++) expect(j.curve[i].x).toBeGreaterThan(j.curve[i - 1].x)
  })

  it('단조 비감소', () => {
    for (let i = 1; i < j.curve.length; i++) {
      expect(j.curve[i].planned).toBeGreaterThanOrEqual(j.curve[i - 1].planned)
    }
  })

  it('샘플에 단계 경계와 오늘이 포함된다', () => {
    const dates = j.curve.map(p => p.date)
    expect(dates).toContain('2026-07-31')
    expect(dates).toContain('2026-08-01')
    expect(dates).toContain(today)
  })

  it('variance = actual - planned', () => {
    expect(j.variance).toBe(j.actual - j.planned)
  })
})

describe('buildJourney — 밴드와 마일스톤', () => {
  const today = '2026-07-09'
  const j = buildJourney(computeTree(rows, today, new Set()), { ...opts, today })!

  it('루트 phase마다 밴드 하나, x0<x1', () => {
    expect(j.bands.map(b => b.id)).toEqual(['P1', 'P2'])
    j.bands.forEach(b => expect(b.x1).toBeGreaterThan(b.x0))
  })

  it('아직 시작 안 한 밴드는 started=false', () => {
    expect(j.bands[0].started).toBe(true)
    expect(j.bands[1].started).toBe(false)
  })

  it('밴드 채움은 phase의 롤업 plannedPct다', () => {
    const tree = computeTree(rows, today, new Set())
    expect(j.bands[0].fillPct).toBe(tree[0].plannedPct)
  })

  it('마일스톤 다이아몬드 — 완료 여부와 x를 담는다', () => {
    expect(j.milestones.map(m => m.id)).toEqual(['kick'])
    expect(j.milestones[0].done).toBe(false)
    expect(j.milestones[0].x).toBeGreaterThan(0)
  })
})

describe('buildJourney — 예측선 게이팅', () => {
  const tree = (today: string) => computeTree(rows, today, new Set())

  it('early(경과 < earlyFloor)면 forecast=null, earlyFloor/elapsed를 노출한다', () => {
    const j = buildJourney(tree('2026-07-09'), { ...opts, today: '2026-07-09' })!
    expect(j.forecast).toBeNull()
    expect(j.earlyFloor).toBe(28)
    expect(j.elapsed).toBe(9)
    expect(j.earlyFloorX).toBeGreaterThan(0)
  })

  it('projectedEnd가 종료일을 넘으면 clipped=true, x는 1로 고정된다', () => {
    const j = buildJourney(tree('2026-08-15'), { ...opts, today: '2026-08-15' })!
    expect(j.forecast).not.toBeNull()
    expect(j.forecast!.clipped).toBe(true)
    expect(j.forecast!.x).toBe(1)
    expect(j.forecast!.slipDays).toBeGreaterThan(0)
  })

  it('projectedEnd가 창 안이면 clipped=false, x<1', () => {
    const onTrack: WbsRow[] = [
      r({ id: 'P', level: 'phase', plannedStart: START, plannedEnd: END }),
      r({ id: 'x', parentId: 'P', plannedStart: START, plannedEnd: END, actualPct: 27 }),
    ]
    const today = '2026-08-15'
    const t = computeTree(onTrack, today, new Set())
    const j = buildJourney(t, { ...opts, today })!
    expect(j.forecast).not.toBeNull()
    expect(j.forecast!.clipped).toBe(false)
    expect(j.forecast!.x).toBeLessThan(1)
  })
})
