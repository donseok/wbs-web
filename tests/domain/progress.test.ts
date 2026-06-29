import { describe, it, expect } from 'vitest'
import { plannedPct, achievementOf, statusOf } from '@/lib/domain/progress'

const H = new Set<string>()

describe('plannedPct', () => {
  it('일정 절반 경과 시 약 50%', () => {
    // 7/6(월)~7/10(금) 5영업일, 오늘 7/8(수)=3영업일 → 60%
    expect(plannedPct('2026-07-06', '2026-07-10', '2026-07-08', H)).toBe(60)
  })
  it('종료일 이후는 100 클램프', () => {
    expect(plannedPct('2026-07-06', '2026-07-10', '2026-07-20', H)).toBe(100)
  })
  it('시작 전은 0', () => {
    expect(plannedPct('2026-07-06', '2026-07-10', '2026-07-01', H)).toBe(0)
  })
  it('날짜 없으면 0', () => {
    expect(plannedPct(null, null, '2026-07-08', H)).toBe(0)
  })
})

describe('achievementOf', () => {
  it('실적/계획', () => { expect(achievementOf(40, 80)).toBe(50) })
  it('계획 0이면 null', () => { expect(achievementOf(0, 0)).toBeNull() })
})

describe('statusOf', () => {
  it('실적 100 → done', () => {
    expect(statusOf(100, 80, '2026-07-06', '2026-07-08')).toBe('done')
  })
  it('실적<계획 → delayed', () => {
    expect(statusOf(40, 60, '2026-07-06', '2026-07-08')).toBe('delayed')
  })
  it('0<실적<=계획 → in_progress', () => {
    expect(statusOf(60, 60, '2026-07-06', '2026-07-08')).toBe('in_progress')
  })
  it('시작 전 → not_started', () => {
    expect(statusOf(0, 0, '2026-07-10', '2026-07-08')).toBe('not_started')
  })
})
