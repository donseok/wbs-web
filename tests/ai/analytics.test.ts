import { describe, it, expect } from 'vitest'
import {
  analyzeProject,
  summarizeProject,
  answerDelayed,
  answerCompleted,
  answerThisWeekStart,
  answerByTeam,
  answerOverview,
  answerWeeklySummary,
  buildDocuments,
} from '@/lib/ai/analytics'
import type { ComputedItem, ProjectMember } from '@/lib/domain/types'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2),
  parentId: 'P',
  level: 'activity',
  code: '1',
  sortOrder: 1,
  name: 'task',
  biz: null,
  deliverable: null,
  plannedStart: null,
  plannedEnd: null,
  weight: null,
  actualPct: null,
  owners: [],
  plannedPct: 0,
  rolledActualPct: 0,
  achievement: null,
  status: 'not_started',
  children: [],
  ...over,
})
const phase = (children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem => ({
  ...leaf({}),
  level: 'phase',
  name: 'Phase A',
  children,
  ...over,
})

const TODAY = '2026-06-30' // 화요일 → 그 주 월 6/29, 일 7/5

describe('analyzeProject', () => {
  const tree = [
    phase(
      [
        leaf({
          name: '지연작업',
          status: 'delayed',
          plannedStart: '2026-06-01',
          plannedEnd: '2026-06-20',
          rolledActualPct: 30,
          plannedPct: 60,
          owners: [{ team: 'PMO', kind: 'primary' }],
        }),
        leaf({ name: '완료작업', status: 'done', plannedStart: '2026-06-01', plannedEnd: '2026-06-10' }),
        leaf({ name: '금주시작', status: 'not_started', plannedStart: '2026-06-30', plannedEnd: '2026-07-04' }),
      ],
      { rolledActualPct: 20, plannedPct: 40 },
    ),
  ]
  const a = analyzeProject(tree, '테스트', TODAY)

  it('리프 수/상태 카운트', () => {
    expect(a.taskCount).toBe(3)
    expect(a.statusCount.delayed).toBe(1)
    expect(a.statusCount.done).toBe(1)
    expect(a.statusCount.not_started).toBe(1)
  })

  it('지연/완료/금주시작 분류', () => {
    expect(a.delayed_.map(l => l.node.name)).toEqual(['지연작업'])
    expect(a.completed_.map(l => l.node.name)).toEqual(['완료작업'])
    expect(a.startingThisWeek.map(l => l.node.name)).toEqual(['금주시작'])
  })

  it('공정률 = 루트 가중 실적', () => {
    expect(a.donePct).toBe(20)
    expect(a.weekRange).toBe('6/29~7/5')
  })
})

describe('의도별 답변 포매터', () => {
  it('answerDelayed — 건수와 작업명 포함', () => {
    const a = analyzeProject([phase([leaf({ name: 'X', status: 'delayed', plannedEnd: '2026-06-20' })])], 'P', TODAY)
    const out = answerDelayed(a)
    expect(out).toContain('지연 작업 1건')
    expect(out).toContain('X')
  })

  it('answerDelayed — 없으면 안내 문구', () => {
    const a = analyzeProject([phase([leaf({ status: 'done' })])], 'P', TODAY)
    expect(answerDelayed(a)).toContain('지연된 작업이 없습니다')
  })

  it('answerCompleted — 없으면 안내', () => {
    const a = analyzeProject([phase([leaf({ status: 'delayed' })])], 'P', TODAY)
    expect(answerCompleted(a)).toContain('아직 완료된 작업이 없습니다')
  })

  it('answerThisWeekStart — 주차 범위 표기', () => {
    const a = analyzeProject([phase([leaf({ status: 'not_started', plannedStart: '2026-06-30' })])], 'P', TODAY)
    expect(answerThisWeekStart(a)).toContain('이번 주(6/29~7/5) 시작 예정 작업 1건')
  })

  it('answerByTeam — 팀별 + 멤버 표기', () => {
    const tree = [phase([leaf({ status: 'done', owners: [{ team: 'PMO', kind: 'primary' }] })])]
    const members: ProjectMember[] = [
      { id: 'm1', projectId: 'P', name: '홍길동', email: null, teamCode: 'PMO', role: 'admin', title: null, hasAccount: false, createdAt: '' },
    ]
    const out = answerByTeam(analyzeProject(tree, 'P', TODAY, members), members)
    expect(out).toContain('PMO — 작업 1건')
    expect(out).toContain('홍길동')
  })
})

describe('answerWeeklySummary — 정수 표기 관례(정수 기반 이슈 인용과 일관)', () => {
  it('반올림 경계에서 공정률 줄과 이슈 인용이 모순되지 않는다', () => {
    // kpi는 소수(43.5/43.7)를 담지만 봇·이슈 문구 모두 정수 기반 → '계획과 동일' + '특이 이슈 없음' 일관.
    const tree = [phase([
      leaf({ name: '진행중', status: 'in_progress', rolledActualPct: 43.5, plannedPct: 43.7, plannedStart: '2026-06-01', plannedEnd: '2026-12-31' }),
    ], { rolledActualPct: 43.5, plannedPct: 43.7 })]
    const out = answerWeeklySummary(analyzeProject(tree, 'P', TODAY))
    expect(out).toContain('실적 44% / 계획 44% (계획과 동일)')
    expect(out).toContain('주요 이슈: 특이 이슈 없음')
  })

  it('격차가 있으면 공정률 줄과 이슈 인용의 %p가 같은 정수', () => {
    const tree = [phase([
      leaf({ name: '진행중', status: 'in_progress', rolledActualPct: 21.3, plannedPct: 43.7, plannedStart: '2026-06-01', plannedEnd: '2026-12-31' }),
    ], { rolledActualPct: 21.3, plannedPct: 43.7 })]
    const out = answerWeeklySummary(analyzeProject(tree, 'P', TODAY))
    expect(out).toContain('실적 21% / 계획 44% (23%p 미달)')
    expect(out).toContain('주요 이슈: 계획 대비 실적 23%p 미달')
  })
})

describe('answerOverview — 전사 합계', () => {
  it('프로젝트 목록 + 합계', () => {
    const s = summarizeProject(
      analyzeProject([phase([leaf({ status: 'done' }), leaf({ status: 'delayed' })], { rolledActualPct: 50 })], 'A', TODAY),
    )
    const out = answerOverview([s])
    expect(out).toContain('전체 1개 프로젝트')
    expect(out).toContain('"A"')
    expect(out).toContain('합계')
  })

  it('빈 입력 → 안내', () => {
    expect(answerOverview([])).toContain('등록된 프로젝트가 없습니다')
  })
})

describe('buildDocuments — 임베딩 문서', () => {
  it('프로젝트 요약 + 작업 + 멤버 문서를 생성', () => {
    const members: ProjectMember[] = [
      { id: 'm1', projectId: 'P', name: '김담당', email: null, teamCode: '가공', role: 'contributor', title: 'BE', hasAccount: false, createdAt: '' },
    ]
    const tree = [phase([leaf({ name: 'T1', deliverable: '설계서' }), leaf({ name: 'T2' })])]
    const docs = buildDocuments(tree, '계량대', TODAY, members)
    expect(docs.some(d => d.kind === 'project')).toBe(true)
    expect(docs.filter(d => d.kind === 'wbs_item')).toHaveLength(2)
    expect(docs.some(d => d.kind === 'member' && d.content.includes('김담당'))).toBe(true)
    expect(docs.find(d => d.content.includes('T1'))?.content).toContain('설계서')
  })
})
