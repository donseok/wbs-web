import { describe, it, expect } from 'vitest'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { buildWeeklyNarrative } from '@/lib/report/narrative'
import type { ComputedItem, Meeting } from '@/lib/domain/types'

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
  it('활동 항목 문구에 담당·상태·공정율 포함', () => {
    const line = n.curr[0].items[0]
    expect(line).toContain('금주진행작업')
    expect(line).toContain('MES')
    expect(line).toContain('진행중')
    expect(line).toContain('50%')
  })
  it('이슈/이벤트는 문자열 배열', () => {
    expect(Array.isArray(n.issues)).toBe(true)
    expect(Array.isArray(n.events)).toBe(true)
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
})
