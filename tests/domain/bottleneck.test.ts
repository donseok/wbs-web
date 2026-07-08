import { describe, it, expect } from 'vitest'
import { buildBottleneck } from '@/lib/domain/bottleneck'
import { computeTree } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import type { TeamCode, WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const TODAY = '2026-07-09'
const own = (t: TeamCode) => [{ team: t, kind: 'primary' as const }]
const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

const rows: WbsRow[] = [
  r({ id: 'P1', level: 'phase', name: '1. 착수', plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
  r({ id: 'P2', level: 'phase', name: '2. 설계', plannedStart: '2026-08-01', plannedEnd: '2026-08-31', sortOrder: 1 }),

  // P1×PMO: 하나는 지연, 하나는 완료 → delayed 가 이긴다
  r({ id: 'a', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', owners: own('PMO') }),
  r({ id: 'b', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', actualPct: 100, owners: own('PMO'), sortOrder: 1 }),

  // P1×ERP: 전부 완료 → done
  r({ id: 'c', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', actualPct: 100, owners: own('ERP'), sortOrder: 2 }),

  // P1×MES: 담당 없음 → unassigned (최우선)
  r({ id: 'd', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', owners: [], sortOrder: 3 }),

  // P1×가공: 진행중 (07-06..07-10 → planned 80, actual 80) → inProgress
  r({ id: 'e', parentId: 'P1', plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 80, owners: own('가공'), sortOrder: 4 }),

  // P2×ERP: 아직 시작 전 → upcoming
  r({ id: 'f', parentId: 'P2', plannedStart: '2026-08-03', plannedEnd: '2026-08-10', owners: own('ERP') }),
]
const tree = computeTree(rows, TODAY, H)

describe('buildBottleneck', () => {
  const m = buildBottleneck(tree, TODAY)

  it('행은 최상위 단계, 열은 TEAMS 순서', () => {
    expect(m.phases.map(p => p.name)).toEqual(['1. 착수', '2. 설계'])
    expect(m.teams).toEqual(['PMO', 'ERP', 'MES', '가공'])
  })

  const cell = (phaseId: string, team: TeamCode) =>
    m.cells.find(c => c.phaseId === phaseId && c.team === team)!

  it('우선순위: unassigned > done > delayed > upcoming > inProgress', () => {
    expect(cell('P1', 'MES').state).toBe('unassigned')   // 담당 없음이 최우선
    expect(cell('P1', 'ERP').state).toBe('done')
    expect(cell('P1', 'PMO').state).toBe('delayed')      // 완료 1 + 지연 1
    expect(cell('P1', '가공').state).toBe('inProgress')
    expect(cell('P2', 'ERP').state).toBe('upcoming')
  })

  it('리프가 없는 셀은 empty', () => {
    expect(cell('P2', 'PMO').state).toBe('empty')
    expect(cell('P2', 'PMO').count).toBe(0)
  })

  it('격자는 항상 phases × teams 크기다 (빈 셀 포함)', () => {
    expect(m.cells.length).toBe(2 * 4)
  })

  it('불변식: Σ cells[].count + unassignedCount === 전체 리프 수', () => {
    const total = m.cells.reduce((s, c) => s + c.count, 0) + m.unassignedCount
    expect(total).toBe(collectLeaves(tree).length)
    expect(total).toBe(6)
  })

  it('unassignedCount는 담당 없는 리프 수, 그 셀의 count는 0', () => {
    expect(m.unassignedCount).toBe(1)
    expect(cell('P1', 'MES').count).toBe(0)
    expect(cell('P1', 'MES').unassigned).toBe(1)
  })

  it('avgProgress는 그 셀 리프들의 단순 평균 (가중 아님)', () => {
    expect(cell('P1', 'PMO').avgProgress).toBe(50)   // (0 + 100) / 2
    expect(cell('P1', 'ERP').avgProgress).toBe(100)
    expect(cell('P2', 'PMO').avgProgress).toBe(0)    // 빈 셀
  })

  it('dday는 셀 안 가장 급한 미완료 리프의 D-day, 없으면 null', () => {
    expect(cell('P1', 'PMO').dday).toBe(-2)          // a: 07-07 → 07-09
    expect(cell('P1', 'ERP').dday).toBeNull()        // 전부 완료
    expect(cell('P2', 'ERP').dday).toBe(32)          // 08-10
    expect(cell('P2', 'PMO').dday).toBeNull()        // 빈 셀
  })

  it('worst는 가장 나쁜 셀 — 미배정 우선, 그다음 지연', () => {
    expect(m.worst?.phaseId).toBe('P1')
    expect(m.worst?.team).toBe('MES')
  })

  it('빈 트리 → 빈 격자, 불변식 유지', () => {
    const e = buildBottleneck([], TODAY)
    expect(e.phases).toEqual([])
    expect(e.cells).toEqual([])
    expect(e.unassignedCount).toBe(0)
    expect(e.worst).toBeNull()
  })
})
