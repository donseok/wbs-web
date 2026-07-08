import { describe, it, expect } from 'vitest'
import { progressSignal } from '@/lib/domain/dashboard'
import { scheduleModel } from '@/lib/domain/dashboard'

describe('progressSignal (편차 %p)', () => {
  it('편차 ≥ -2 → green', () => {
    expect(progressSignal(0)).toBe('green')
    expect(progressSignal(-2)).toBe('green')   // 경계: green 소유
  })
  it('-10 ≤ 편차 < -2 → amber', () => {
    expect(progressSignal(-3)).toBe('amber')
    expect(progressSignal(-10)).toBe('amber')  // 경계: amber 소유
  })
  it('편차 < -10 → red', () => {
    expect(progressSignal(-11)).toBe('red')
  })
})

const sched = (over: Partial<Parameters<typeof scheduleModel>[0]> = {}) =>
  scheduleModel({ startDate: '2026-01-01', endDate: '2026-04-10', today: '2026-02-20', overallActual: 49, overallPlanned: 50, ...over })
// start~end 캘린더 totalDays = 100

describe('scheduleModel', () => {
  it('날짜 없으면 neutral/none', () => {
    const r = scheduleModel({ startDate: null, endDate: null, today: '2026-02-20', overallActual: 10, overallPlanned: 10 })
    expect(r.signal).toBe('neutral'); expect(r.label).toBe('none'); expect(r.projectedEnd).toBeNull()
  })
  it('완료(actual≥100) → green/done, slip·projectedEnd 숨김', () => {
    const r = sched({ overallActual: 100, overallPlanned: 100, today: '2026-05-01' })
    expect(r.signal).toBe('green'); expect(r.label).toBe('done'); expect(r.slipDays).toBeNull(); expect(r.projectedEnd).toBeNull()
  })
  it('계획<5% → neutral/early', () => {
    expect(sched({ overallPlanned: 3, overallActual: 1 }).label).toBe('early')
    expect(sched({ overallPlanned: 3, overallActual: 1 }).signal).toBe('neutral')
  })
  it('경과<15% 바닥 → neutral/early', () => {
    const r = sched({ today: '2026-01-05' }) // elapsed 5 < max(14, 15)
    expect(r.label).toBe('early'); expect(r.signal).toBe('neutral')
  })
  it('정상(slip≤3) → green', () => {
    expect(sched({ overallActual: 49, overallPlanned: 50 }).signal).toBe('green') // SPI .98 → slip 2
  })
  it('주의(3<slip≤14) → amber', () => {
    expect(sched({ overallActual: 45, overallPlanned: 50 }).signal).toBe('amber') // slip 11
  })
  it('위험(slip>14) → red', () => {
    expect(sched({ overallActual: 40, overallPlanned: 50 }).signal).toBe('red') // slip 25
  })
  it('종료일 경과+미완료 → red (slip이 amber라도)', () => {
    const r = sched({ today: '2026-05-01', overallActual: 90, overallPlanned: 100 })
    expect(r.signal).toBe('red')
  })
  it('clamp — actual 극소면 projectedDuration 상한(3×), slip=2×total', () => {
    const r = sched({ overallActual: 2, overallPlanned: 40 }) // SPI .05 → raw 2000
    expect(r.slipDays).toBe(200) // 300 - 100
    expect(r.signal).toBe('red')
  })
})
