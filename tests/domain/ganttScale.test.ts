import { describe, it, expect } from 'vitest'
import { buildGanttScale, collectPlannedDates } from '@/lib/domain/ganttScale'

describe('buildGanttScale', () => {
  it('양끝 일자 포함하여 day 배열 생성', () => {
    const s = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(s.rangeStart).toBe('2026-07-06')
    expect(s.rangeEnd).toBe('2026-07-10')
    expect(s.days).toEqual(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'])
    expect(s.ganttW).toBe(5 * 24)
  })

  it('xOf는 시작일 기준 일수 × dayPx', () => {
    const s = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(s.xOf('2026-07-06')).toBe(0)
    expect(s.xOf('2026-07-08')).toBe(2 * 24)
  })

  it('주말 판정', () => {
    const s = buildGanttScale(['2026-07-06', '2026-07-12'], '2026-07-06', 24)
    expect(s.isWeekend('2026-07-11')).toBe(true) // 토
    expect(s.isWeekend('2026-07-12')).toBe(true) // 일
    expect(s.isWeekend('2026-07-10')).toBe(false) // 금
  })

  it('기준일이 범위 안이면 todayX 계산, 밖이면 null', () => {
    const inRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(inRange.todayX).toBe(2 * 24 + 12)
    const outRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-08-01', 24)
    expect(outRange.todayX).toBeNull()
  })

  it('일자 없으면 today를 단일 범위로', () => {
    const s = buildGanttScale([], '2026-07-08', 24)
    expect(s.rangeStart).toBe('2026-07-08')
    expect(s.rangeEnd).toBe('2026-07-08')
    expect(s.days).toEqual(['2026-07-08'])
  })

  it('월/주 밴드 생성', () => {
    const s = buildGanttScale(['2026-07-06', '2026-08-05'], '2026-07-10', 24)
    expect(s.months.map(m => m.label)).toEqual(['7월', '8월'])
    expect(s.weeks[0].label).toBe('W01')
    expect(s.weeks.length).toBeGreaterThan(1)
  })
})

describe('collectPlannedDates', () => {
  it('트리 전체에서 계획 일자를 평탄 수집', () => {
    const tree = [
      {
        plannedStart: '2026-07-01', plannedEnd: '2026-07-09', children: [
          { plannedStart: '2026-07-01', plannedEnd: '2026-07-07', children: [] },
          { plannedStart: null, plannedEnd: null, children: [] },
        ],
      },
    ]
    const dates = collectPlannedDates(tree)
    expect(dates).toContain('2026-07-01')
    expect(dates).toContain('2026-07-09')
    expect(dates).toContain('2026-07-07')
    expect(dates).not.toContain(null as unknown as string)
  })
})
