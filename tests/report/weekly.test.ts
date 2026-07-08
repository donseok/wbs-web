import { describe, it, expect } from 'vitest'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import type { Announcement, AttendanceRecord, ComputedItem, Meeting, ProjectMember } from '@/lib/domain/types'

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: Math.random().toString(36).slice(2), projectId: 'p', title: '회의', meetingDate: '2026-07-01',
  startTime: '14:00', endTime: '15:00', location: '회의실 A', category: 'routine', body: '',
  recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01', attendeeIds: ['m1', 'm2'], ...over,
})

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
    node({ name: '화면 설계', status: 'in_progress', rolledActualPct: 99, owners: [{ team: '가공', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
    node({ name: 'API 설계', status: 'delayed', rolledActualPct: 40, owners: [{ team: '가공', kind: 'primary' }], plannedStart: '2026-05-21', plannedEnd: '2026-05-22' }),
    node({ name: '차주 개발', status: 'in_progress', rolledActualPct: 40, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
  ], { weight: 1, plannedPct: 100, rolledActualPct: 60, status: 'delayed' }),
]
const project = { name: 'D-CUBE PI', description: 'PI', start_date: '2026-04-20', end_date: '2026-12-31' }

describe('buildWeeklyReportModel — 주차', () => {
  const m = buildWeeklyReportModel(items, project, '2026-06-30')
  it('월기준 주차(6월 5주차) + 주 범위', () => {
    // 월기준 주차 = ceil(오늘 일자/7): 6/30 → ceil(30/7)=5
    expect(m.meta.weekTag).toBe('6월5주차')
    expect(m.meta.weekLabel).toBe('2026년 6월 5주차 (6/29~7/5)')
    expect(m.meta.isoWeek).toBe(27) // ISO 주차는 메타로 계속 보존
    expect(m.meta.weekRange).toBe('6/29~7/5')
    expect(m.meta.nextWeekRange).toBe('7/6~7/12')
    expect(m.meta.weekStart).toBe('2026-06-29')
    expect(m.meta.weekDays).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'])
  })
  it('월초 날짜는 1주차(7/4 → 7월1주차)', () => {
    const j = buildWeeklyReportModel(items, project, '2026-07-04')
    expect(j.meta.weekTag).toBe('7월1주차')
    expect(j.meta.weekLabel).toContain('2026년 7월 1주차')
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
    { id: 'mem1', projectId: 'p', name: '홍길동', email: null, teamCode: '가공', role: 'contributor', title: null, userId: null, createdAt: '2026-01-01' },
    { id: 'mem2', projectId: 'p', name: '김철수', email: null, teamCode: 'PMO', role: 'admin', title: null, userId: null, createdAt: '2026-01-01' },
  ]
  const attendance: AttendanceRecord[] = [
    { id: 'a1', projectId: 'p', memberId: 'mem1', date: '2026-06-30', type: 'annual', note: null },
    { id: 'a2', projectId: 'p', memberId: 'mem2', date: '2026-06-29', type: 'work', note: null },
  ]
  const m = buildWeeklyReportModel(items, project, '2026-06-30', { members, attendance })
  it('워크로드는 팀별 4행, 합계 일관', () => {
    expect(m.workload.map(w => w.name)).toEqual(['PMO', 'ERP', 'MES', '가공'])
    const dt = m.workload.find(w => w.name === '가공')!
    expect(dt.total).toBe(dt.perDay.reduce((a, b) => a + b, 0))
  })
  it('근태는 특이근태 멤버만(정상근무 제외)', () => {
    // mem1 연차 1건 → 포함, mem2 정상근무만 → 제외
    expect(m.attendance.thisWeek.map(r => r.memberName)).toEqual(['홍길동'])
    expect(m.attendance.thisWeek[0].count).toBe(1)
  })
})

describe('buildWeeklyReportModel — 회의일정', () => {
  // today=2026-06-30 → 금주 6/29~7/5, 차주 7/6~7/12
  const meetings: Meeting[] = [
    meeting({ title: '주간 정례회의', meetingDate: '2026-07-01', startTime: '10:00', endTime: '11:00' }),
    meeting({ title: '착수 보고회', meetingDate: '2026-07-08', startTime: null, endTime: null, location: null, attendeeIds: ['m1'] }),
    meeting({ title: '범위 밖', meetingDate: '2026-07-20' }), // 차주 밖 → 제외
  ]
  const m = buildWeeklyReportModel(items, project, '2026-06-30', { meetings })

  it('금주/차주로 분리하고 범위 밖은 제외', () => {
    expect(m.meetings.thisWeek.map(r => r.title)).toEqual(['주간 정례회의'])
    expect(m.meetings.nextWeek.map(r => r.title)).toEqual(['착수 보고회'])
    expect(m.meetings.total).toBe(2)
  })
  it('일자·시간·장소·참석 표기', () => {
    const t = m.meetings.thisWeek[0]
    expect(t.date).toBe('7/1(수)')
    expect(t.time).toBe('10:00~11:00')
    expect(t.location).toBe('회의실 A')
    expect(t.attendeeCount).toBe(2)
    const n = m.meetings.nextWeek[0] // 종일 + 장소 없음
    expect(n.time).toBe('종일')
    expect(n.location).toBe('-')
  })
  it('회의 없으면 total 0(페이지 생략 조건)', () => {
    expect(buildWeeklyReportModel(items, project, '2026-06-30').meetings.total).toBe(0)
  })
})

describe('prevWeek — 전주 주요활동', () => {
  // today=2026-07-07(화) → 이번주 월=7/6, 지난주 월=6/29~7/5
  const items: ComputedItem[] = [
    phase('설계', [
      node({ name: '전주완료작업', status: 'done', rolledActualPct: 100, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      node({ name: '금주진행작업', status: 'in_progress', rolledActualPct: 50, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      node({ name: '미착수작업', status: 'not_started', rolledActualPct: 0, owners: [], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
    ], { weight: 1, plannedPct: 100, rolledActualPct: 60 }),
  ]
  const project = { name: 'D-CUBE PI', description: null, start_date: null, end_date: null }
  const m = buildWeeklyReportModel(items, project, '2026-07-07')

  it('meta에 전주 범위/기간이 있다', () => {
    expect(m.meta.prevWeekRange).toBe('6/29~7/5')
    expect(m.meta.prevWeekStart).toBe('2026-06-29')
    expect(m.meta.prevWeekDays).toHaveLength(5)
    expect(m.meta.prevWeekDays[0]).toBe('2026-06-29')
  })
  it('전주 겹침+진행/완료 작업만 prevWeek에 담기고, 미착수는 제외', () => {
    const names = m.planActual.flatMap(p => p.prevWeek.map(t => t.name))
    expect(names).toContain('전주완료작업')
    expect(names).not.toContain('미착수작업')
    expect(names).not.toContain('금주진행작업')
  })
  it('기존 thisWeek(진행중) 정의는 불변 — 금주진행작업만', () => {
    const names = m.planActual.flatMap(p => p.thisWeek.map(t => t.name))
    expect(names).toEqual(['금주진행작업'])
  })
})

describe('buildWeeklyReportModel — 공지', () => {
  // today=2026-07-07(화) → 금주 7/6~7/12, 전주 6/29~7/5
  const items: ComputedItem[] = [phase('설계', [node({ name: 'a' })], { weight: 1 })]
  const project = { name: 'D-CUBE PI', description: null, start_date: null, end_date: null }
  const ann = (over: Partial<Announcement>): Announcement => ({
    id: Math.random().toString(36).slice(2), projectId: 'p', title: 't', body: '',
    category: 'general', isPinned: false, publishFrom: null, publishTo: null,
    createdAt: '2026-07-07T00:00:00Z', updatedAt: '2026-07-07T00:00:00Z', ...over,
  })

  it('publishFrom 기준으로 전주/금주에 분류하고, 범위 밖 공지는 제외', () => {
    const m = buildWeeklyReportModel(items, project, '2026-07-07', {
      announcements: [
        ann({ title: '전주공지', publishFrom: '2026-07-01' }),
        ann({ title: '금주공지', publishFrom: '2026-07-06' }),
        ann({ title: '옛날공지', publishFrom: '2026-05-01' }),
      ],
    })
    expect(m.announcements.prevWeek.map(a => a.title)).toEqual(['전주공지'])
    expect(m.announcements.thisWeek.map(a => a.title)).toEqual(['금주공지'])
    expect(m.announcements.total).toBe(2)
  })

  it('publishFrom이 없으면 createdAt을 KST 날짜로 환산해 분류(UTC 슬라이스 아님)', () => {
    // 2026-07-05T15:30Z = KST 2026-07-06 00:30 → 금주(7/6~) 이다. UTC로 자르면 7/5(전주)로 오분류된다.
    const m = buildWeeklyReportModel(items, project, '2026-07-07', {
      announcements: [ann({ title: '경계공지', createdAt: '2026-07-05T15:30:00Z' })],
    })
    expect(m.announcements.thisWeek.map(a => a.title)).toEqual(['경계공지'])
    expect(m.announcements.prevWeek).toEqual([])
  })

  it('공지 날짜 오름차순 정렬 + 옵션 미전달 시 빈 목록', () => {
    const m = buildWeeklyReportModel(items, project, '2026-07-07', {
      announcements: [
        ann({ title: '늦은', publishFrom: '2026-07-09' }),
        ann({ title: '이른', publishFrom: '2026-07-06' }),
      ],
    })
    expect(m.announcements.thisWeek.map(a => a.title)).toEqual(['이른', '늦은'])
    expect(m.announcements.thisWeek[0].date).toBe('2026-07-06')

    const none = buildWeeklyReportModel(items, project, '2026-07-07')
    expect(none.announcements).toEqual({ prevWeek: [], thisWeek: [], total: 0 })
  })
})
