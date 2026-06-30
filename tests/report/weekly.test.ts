import { describe, it, expect } from 'vitest'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import type { AttendanceRecord, ComputedItem, ProjectMember } from '@/lib/domain/types'

const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem
const phase = (name: string, children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem =>
  node({ level: 'phase', name, children, ...over })

// today = 2026-06-30 (화), ISO 27주차, 주: 6/29(월)~7/5(일), 차주: 7/6~7/12
const items: ComputedItem[] = [
  phase('분석', [
    node({ name: '현황 분석', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-04-20', plannedEnd: '2026-04-29' }),
  ], { weight: 1, plannedPct: 100, rolledActualPct: 100, status: 'done' }),
  phase('설계', [
    node({ name: '화면 설계', status: 'in_progress', rolledActualPct: 99, owners: [{ team: 'DT', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
    node({ name: 'API 설계', status: 'delayed', rolledActualPct: 40, owners: [{ team: 'DT', kind: 'primary' }], plannedStart: '2026-05-21', plannedEnd: '2026-05-22' }),
    node({ name: '차주 개발', status: 'in_progress', rolledActualPct: 40, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
  ], { weight: 1, plannedPct: 100, rolledActualPct: 60, status: 'delayed' }),
]
const project = { name: 'D-CUBE PI', description: 'PI', start_date: '2026-04-20', end_date: '2026-12-31' }

describe('buildWeeklyReportModel — 주차', () => {
  const m = buildWeeklyReportModel(items, project, '2026-06-30')
  it('ISO 27주차 + 주 범위', () => {
    expect(m.meta.isoWeek).toBe(27)
    expect(m.meta.weekRange).toBe('6/29~7/5')
    expect(m.meta.nextWeekRange).toBe('7/6~7/12')
    expect(m.meta.weekStart).toBe('2026-06-29')
    expect(m.meta.weekLabel).toBe('2026년 27주차 (6/29~7/5)')
    expect(m.meta.weekDays).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'])
  })
})

describe('buildWeeklyReportModel — KPI/상태', () => {
  const m = buildWeeklyReportModel(items, project, '2026-06-30')
  it('상태별 카운트(leaf)', () => {
    expect(m.kpi.total).toBe(4)
    expect(m.kpi.done).toBe(1)
    expect(m.kpi.inProgress).toBe(2)
    expect(m.kpi.delayed).toBe(1)
    expect(m.kpi.onHold).toBe(0)
  })
  it('금주 실적=진행중 2, 차주 계획=차주 겹치는 미완료 1', () => {
    expect(m.kpi.inProgress).toBe(2)
    expect(m.kpi.nextWeekPlanCount).toBe(1)
  })
  it('최대 지연일 > 0 (API 설계 2026-05-22 종료)', () => {
    expect(m.kpi.maxDelayDays).toBeGreaterThan(0)
  })
})

describe('buildWeeklyReportModel — Phase', () => {
  const m = buildWeeklyReportModel(items, project, '2026-06-30')
  it('점유율 정규화 합 100', () => {
    expect(m.phases.reduce((s, p) => s + p.weightPct, 0)).toBe(100)
  })
  it('Phase별 완료/전체·지연·격차', () => {
    const design = m.phases.find(p => p.name === '설계')!
    expect(design.totalCount).toBe(3)
    expect(design.doneCount).toBe(0)
    expect(design.delayedCount).toBe(1)
    expect(design.gap).toBe(design.plannedPct - design.actualPct)
  })
})

describe('buildWeeklyReportModel — 공정실적및계획', () => {
  const m = buildWeeklyReportModel(items, project, '2026-06-30')
  it('Phase별 금주(진행중)/차주', () => {
    const design = m.planActual.find(p => p.phaseName === '설계')!
    expect(design.thisWeek.map(t => t.name)).toContain('화면 설계')
    expect(design.nextWeek.map(t => t.name)).toEqual(['차주 개발'])
  })
})

describe('buildWeeklyReportModel — 이슈/WBS/Dev', () => {
  const m = buildWeeklyReportModel(items, project, '2026-06-30')
  it('지연 있으면 이슈 자동 생성', () => {
    expect(m.issues.length).toBeGreaterThanOrEqual(1)
    expect(m.issues[0].grade).toBe('높음')
    expect(m.issues.some(i => i.content.includes('지연 작업'))).toBe(true)
  })
  it('WBS 플랫은 전체 노드(Phase 2 + leaf 4)=6', () => {
    expect(m.wbs.length).toBe(6)
    expect(m.wbs[0].levelLabel).toBe('Phase')
    expect(m.wbs[0].depth).toBe(0)
  })
  it('Dev=미완료 leaf 3건, 지연일 내림차순', () => {
    expect(m.dev.length).toBe(3)
    expect(m.dev[0].delayDays).toBeGreaterThanOrEqual(m.dev[1].delayDays)
  })
})

describe('buildWeeklyReportModel — 워크로드/근태', () => {
  const members: ProjectMember[] = [
    { id: 'mem1', projectId: 'p', name: '홍길동', email: null, teamCode: 'DT', role: 'contributor', title: null, createdAt: '2026-01-01' },
    { id: 'mem2', projectId: 'p', name: '김철수', email: null, teamCode: 'PMO', role: 'admin', title: null, createdAt: '2026-01-01' },
  ]
  const attendance: AttendanceRecord[] = [
    { id: 'a1', projectId: 'p', memberId: 'mem1', date: '2026-06-30', type: 'annual', note: null },
    { id: 'a2', projectId: 'p', memberId: 'mem2', date: '2026-06-29', type: 'work', note: null },
  ]
  const m = buildWeeklyReportModel(items, project, '2026-06-30', { members, attendance })
  it('워크로드는 팀별 4행, 합계 일관', () => {
    expect(m.workload.map(w => w.name)).toEqual(['PMO', 'DT', 'ERP', 'MES'])
    const dt = m.workload.find(w => w.name === 'DT')!
    expect(dt.total).toBe(dt.perDay.reduce((a, b) => a + b, 0))
  })
  it('근태는 특이근태 멤버만(정상근무 제외)', () => {
    // mem1 연차 1건 → 포함, mem2 정상근무만 → 제외
    expect(m.attendance.thisWeek.map(r => r.memberName)).toEqual(['홍길동'])
    expect(m.attendance.thisWeek[0].count).toBe(1)
  })
})
