import { describe, it, expect } from 'vitest'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
import type { Announcement, ComputedItem, Meeting } from '@/lib/domain/types'

const NB = ' ' // non-breaking space

const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem
const phase = (name: string, children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem =>
  node({ level: 'phase', name, children, ...over })

const items: ComputedItem[] = [
  phase('설계', [
    node({ name: '전주완료작업', status: 'done', rolledActualPct: 100, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
    node({ name: '금주진행작업', status: 'in_progress', rolledActualPct: 50, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
  ], { weight: 1, plannedPct: 100, rolledActualPct: 60 }),
]
const project = { name: 'D-CUBE PI', description: null, start_date: null, end_date: null }

describe('buildWeeklyNarrative', () => {
  const m = buildWeeklyReportModel(items, project, '2026-07-07')
  const n = buildWeeklyNarrative(m)

  it('prev/curr가 Phase 그룹으로 나오고 빈 Phase는 제외', () => {
    expect(n.prev.map(g => g.phase)).toContain('설계')
    expect(n.prev[0].items.some(s => s.includes('전주완료작업'))).toBe(true)
    expect(n.curr[0].items.some(s => s.includes('금주진행작업'))).toBe(true)
  })
  it('활동 항목 문구에 담당·상태 포함(진행률 % 제외)', () => {
    const line = n.curr[0].items[0]
    expect(line).toContain('금주진행작업')
    expect(line).toContain('MES')
    expect(line).toContain('진행중')
    expect(line).not.toContain('%')
    expect(line).not.toContain('50')
  })
  it('이슈/이벤트는 문자열 배열', () => {
    expect(Array.isArray(n.issues)).toBe(true)
    expect(Array.isArray(n.events)).toBe(true)
  })
  it('Phase 번호(num)가 전주·금주에서 동일 Phase에 같은 값', () => {
    // 준비(index0): 준비완료작업(done, 전주) → 전주만. 설계(index1): 설계작업(in_progress, 전주+금주) → 양쪽.
    const twoPhase: ComputedItem[] = [
      phase('준비', [
        node({ name: '준비완료작업', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 100 }),
      phase('설계', [
        node({ name: '설계작업', status: 'in_progress', rolledActualPct: 60, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 60 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(twoPhase, project, '2026-07-07'))
    const prevPrep = n2.prev.find(g => g.phase === '준비')!
    const prevDesign = n2.prev.find(g => g.phase === '설계')!
    const currDesign = n2.curr.find(g => g.phase === '설계')!
    expect(prevPrep.num).toBe(1)
    expect(prevDesign.num).toBe(2)
    // 준비(1)가 금주에 없어도 설계는 재번호되지 않고 2 유지
    expect(currDesign.num).toBe(2)
    expect(n2.curr.find(g => g.phase === '준비')).toBeUndefined()
  })

  it('메타(담당·상태)는 비분리 공백으로 묶이고 진행률 %는 없음', () => {
    const NB = String.fromCharCode(0xa0) // non-breaking space (U+00A0)
    const line = n.curr[0].items[0] // 금주진행작업 · MES · 진행중
    expect(line).toContain(`·${NB}MES${NB}·${NB}진행중`) // 담당·상태가 NBSP로 묶임
    expect(line).not.toContain('%')                       // 진행률(%) 제거
    expect(line).toContain('금주진행작업 ')               // 작업명과 메타 사이는 일반 공백(줄바꿈 지점)
  })

  it('회의가 있으면 events에 반영', () => {
    // today=2026-07-07(화) → 금주 범위는 7/6~7/12 (buildWeeklyReportModel의 월요일 기준 계산).
    // meetingDate 2026-07-10 은 금주 범위 안 → model.meetings.thisWeek 로 전개되어야 events 에 반영된다.
    const meetings: Meeting[] = [
      {
        id: 'mtg1', projectId: 'p', title: 'Kick-Off', meetingDate: '2026-07-10',
        startTime: '14:00', endTime: '15:00', location: '대회의실', category: 'kickoff', body: '',
        recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', attendeeIds: Array.from({ length: 8 }, (_, i) => `m${i}`),
      },
    ]
    const m2 = buildWeeklyReportModel(items, project, '2026-07-07', { meetings })
    const n2 = buildWeeklyNarrative(m2)
    expect(n2.events.some(e => e.includes('Kick-Off'))).toBe(true)
  })

  it('공지가 있으면 전주/금주 활동 끝에 "주요 공지" 그룹으로 붙는다', () => {
    const ann = (title: string, publishFrom: string): Announcement => ({
      id: title, projectId: 'p', title, body: '', category: 'general', isPinned: false,
      publishFrom, publishTo: null, createdAt: '2026-07-07T00:00:00Z', updatedAt: '2026-07-07T00:00:00Z',
    })
    const m2 = buildWeeklyReportModel(items, project, '2026-07-07', {
      announcements: [ann('전주 킥오프 안내', '2026-07-01'), ann('금주 산출물 마감', '2026-07-06')],
    })
    const n2 = buildWeeklyNarrative(m2)

    const prevAnn = n2.prev.at(-1)!   // WBS Phase 그룹 뒤에 append
    const currAnn = n2.curr.at(-1)!
    expect(prevAnn.phase).toBe('주요 공지')
    expect(prevAnn.items).toEqual(['전주 킥오프 안내'])
    expect(currAnn.phase).toBe('주요 공지')
    expect(currAnn.items).toEqual(['금주 산출물 마감'])
    // WBS 그룹은 그대로 유지되고 앞에 온다
    expect(n2.prev[0].phase).toBe('설계')
  })

  it('공지 없으면 "주요 공지" 그룹이 생기지 않고 WBS-only 동작 유지', () => {
    expect(n.prev.some(g => g.phase === '주요 공지')).toBe(false)
    expect(n.curr.some(g => g.phase === '주요 공지')).toBe(false)
    expect(n.prev.length).toBeGreaterThan(0)
  })
})
