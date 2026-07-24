import { describe, it, expect } from 'vitest'
import { buildGanttScale, centeredTimelineScrollLeft, collectPlannedDates } from '@/lib/domain/ganttScale'

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

  it('기준일이 일정 밖이어도 축에 포함해 todayX를 항상 계산', () => {
    const inRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(inRange.todayX).toBe(2 * 24 + 12)

    const afterRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-08-01', 24)
    expect(afterRange.rangeEnd).toBe('2026-08-01')
    expect(afterRange.todayX).toBe(afterRange.ganttW - 12)

    const beforeRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-06-20', 24)
    expect(beforeRange.rangeStart).toBe('2026-06-20')
    expect(beforeRange.todayX).toBe(12)
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

describe('centeredTimelineScrollLeft', () => {
  it('sticky 열을 제외한 실제 타임라인 가시 영역 중앙에 기준일을 배치', () => {
    expect(centeredTimelineScrollLeft({
      timelineLeft: 1198,
      dateX: 1068,
      frozenWidth: 404,
      viewportWidth: 1200,
      scrollWidth: 3406,
    })).toBe(1464)
  })

  it('스크롤 가능 범위의 시작과 끝으로 안전하게 제한', () => {
    expect(centeredTimelineScrollLeft({
      timelineLeft: 100,
      dateX: 0,
      frozenWidth: 400,
      viewportWidth: 1200,
      scrollWidth: 1000,
    })).toBe(0)
    expect(centeredTimelineScrollLeft({
      timelineLeft: 1198,
      dateX: 5000,
      frozenWidth: 404,
      viewportWidth: 1200,
      scrollWidth: 3406,
    })).toBe(2206)
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
