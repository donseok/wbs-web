import { describe, it, expect } from 'vitest'
import { buildReportModel } from '@/lib/report/model'
import type { ComputedItem } from '@/lib/domain/types'

/** ComputedItem 빌더 (테스트용). */
const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

const phase = (name: string, children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem =>
  node({ level: 'phase', name, children, ...over })

const project = { name: '테스트 프로젝트', description: '설명', start_date: '2026-01-01', end_date: '2026-12-31' }

describe('buildReportModel', () => {
  it('빈 WBS → 0 KPI, 빈 목록, 팀 5개(모두 null)', () => {
    const m = buildReportModel([], project, '2026-06-30')
    expect(m.kpi).toEqual({ actual: 0, planned: 0, variance: 0, delayedCount: 0 })
    expect(m.phases).toEqual([])
    expect(m.delayed).toEqual([])
    expect(m.teams.map(t => t.team)).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
    expect(m.teams.every(t => t.count === 0 && t.pct === null)).toBe(true)
    expect(m.meta.totalLeaves).toBe(0)
  })

  it('meta는 프로젝트/오늘 값을 반영', () => {
    const m = buildReportModel([], project, '2026-06-30')
    expect(m.meta).toMatchObject({
      projectName: '테스트 프로젝트', description: '설명',
      today: '2026-06-30', startDate: '2026-01-01', endDate: '2026-12-31',
    })
  })

  it('description/기간 null 허용', () => {
    const m = buildReportModel([], { name: 'P' }, '2026-06-30')
    expect(m.meta.description).toBeNull()
    expect(m.meta.startDate).toBeNull()
    expect(m.meta.endDate).toBeNull()
  })

  it('KPI: 전체 실적/계획/편차/지연수', () => {
    const items = [
      phase('P1', [node({ rolledActualPct: 80, status: 'in_progress' })], { plannedPct: 60, rolledActualPct: 80 }),
      phase('P2', [node({ rolledActualPct: 20, status: 'delayed' })], { plannedPct: 40, rolledActualPct: 20 }),
    ]
    const m = buildReportModel(items, project, '2026-06-30')
    // weight 모두 null → 단순 평균. actual=(80+20)/2=50, planned=(60+40)/2=50
    expect(m.kpi.actual).toBe(50)
    expect(m.kpi.planned).toBe(50)
    expect(m.kpi.variance).toBe(0)
    expect(m.kpi.delayedCount).toBe(1)
  })

  it('phases: 루트별 계획/실적/편차/상태', () => {
    const items = [phase('설계', [node({ rolledActualPct: 30 })], { plannedPct: 50, rolledActualPct: 30, status: 'delayed' })]
    const m = buildReportModel(items, project, '2026-06-30')
    expect(m.phases).toEqual([
      { name: '설계', plannedPct: 50, actualPct: 30, variance: -20, status: 'delayed' },
    ])
  })

  it('delayed: leaf 중 status delayed만, 종료일 오름차순', () => {
    const items = [
      phase('P', [
        node({ name: 'A', status: 'delayed', plannedEnd: '2026-03-10', rolledActualPct: 40, owners: [{ team: '가공', kind: 'primary' }] }),
        node({ name: 'B', status: 'delayed', plannedEnd: '2026-01-05', rolledActualPct: 10 }),
        node({ name: 'C', status: 'in_progress', plannedEnd: '2026-02-01' }),
      ]),
    ]
    const m = buildReportModel(items, project, '2026-06-30')
    expect(m.delayed.map(d => d.name)).toEqual(['B', 'A']) // 종료일 오름차순
    expect(m.delayed[1]).toMatchObject({ name: 'A', plannedEnd: '2026-03-10', actualPct: 40, owners: [{ team: '가공', kind: 'primary' }] })
  })

  it('teams: 담당(owners) 기준 count + 평균 실적, 미담당은 null', () => {
    const items = [
      phase('P', [
        node({ rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }] }),
        node({ rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'support' }] }),
        node({ rolledActualPct: 20, owners: [{ team: '가공', kind: 'primary' }] }),
      ]),
    ]
    const m = buildReportModel(items, project, '2026-06-30')
    const pmo = m.teams.find(t => t.team === 'PMO')!
    const dt = m.teams.find(t => t.team === '가공')!
    const erp = m.teams.find(t => t.team === 'ERP')!
    expect(pmo).toMatchObject({ count: 2, pct: 75 }) // (100+50)/2
    expect(dt).toMatchObject({ count: 1, pct: 20 })
    expect(erp).toMatchObject({ count: 0, pct: null })
  })

  it('전체 실적/계획·편차는 대시보드와 같은 소수 1자리, Phase 표는 정수 유지', () => {
    const items = [
      phase('P1', [node({ rolledActualPct: 21.3, status: 'in_progress' })], { plannedPct: 43.7, rolledActualPct: 21.3 }),
    ]
    const m = buildReportModel(items, project, '2026-06-30')
    expect(m.kpi.actual).toBe(21.3)
    expect(m.kpi.planned).toBe(43.7)
    expect(m.kpi.variance).toBe(-22.4)                    // round1(21.3-43.7) — 부동소수 잔차 없음
    expect(m.phases[0]).toMatchObject({ plannedPct: 44, actualPct: 21, variance: -23 })
  })

  it('상위(자식 있는) 항목은 leaf 집계에서 제외', () => {
    const items = [phase('P', [node({ name: 'leaf', owners: [{ team: 'ERP', kind: 'primary' }], rolledActualPct: 60 })])]
    const m = buildReportModel(items, project, '2026-06-30')
    expect(m.meta.totalLeaves).toBe(1) // phase는 제외, leaf 1개만
    expect(m.teams.find(t => t.team === 'ERP')!.count).toBe(1)
  })
})
