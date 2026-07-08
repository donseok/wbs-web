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

import { detectMilestones } from '@/lib/domain/dashboard'
import type { ComputedItem } from '@/lib/domain/types'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], ...over,
})

describe('detectMilestones', () => {
  const today = '2026-07-08'
  it('키워드 매칭 + 임박(D-14 이내) → amber', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-17', sortOrder: 1 })], today)
    expect(r.name).toBe('중간보고'); expect(r.signal).toBe('amber'); expect(r.dday).toBe(9)
  })
  it('여유(D-15+) → green', () => {
    const r = detectMilestones([leaf({ name: '착수보고회', plannedEnd: '2026-08-01' })], today)
    expect(r.signal).toBe('green')
  })
  it('단일일 + 산출물 → 감지', () => {
    const r = detectMilestones([leaf({ name: '워크샵', plannedStart: '2026-07-20', plannedEnd: '2026-07-20', deliverable: '결과보고' })], today)
    expect(r.name).toBe('워크샵')
  })
  it('날짜 null + 산출물 리프는 감지 안 함(null===null 함정 방지)', () => {
    const r = detectMilestones([leaf({ name: '일반작업', deliverable: '산출물', plannedStart: null, plannedEnd: null })], today)
    expect(r.name).toBeNull(); expect(r.signal).toBe('neutral')
  })
  it('지연 마일스톤(예정일 경과+미완료) → red', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-01', status: 'delayed' })], today)
    expect(r.overdue).toBe(true); expect(r.signal).toBe('red')
  })
  it('완료된 마일스톤은 제외', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-20', status: 'done' })], today)
    expect(r.name).toBeNull()
  })
  it('미감지 → neutral', () => {
    expect(detectMilestones([leaf({ name: '일반작업', plannedEnd: '2026-07-20' })], today).signal).toBe('neutral')
  })
  it('다음 마일스톤 동점은 sortOrder로 결정', () => {
    const r = detectMilestones([
      leaf({ name: '중간보고 B', plannedEnd: '2026-07-20', sortOrder: 5 }),
      leaf({ name: '중간보고 A', plannedEnd: '2026-07-20', sortOrder: 2 }),
    ], today)
    expect(r.name).toBe('중간보고 A')
  })
})

import { delayedLeaves, dueSoonLeaves } from '@/lib/domain/dashboard'

describe('delayedLeaves / dueSoonLeaves', () => {
  const today = '2026-07-08'
  it('delayedLeaves — status delayed만', () => {
    const ls = [leaf({ status: 'delayed' }), leaf({ status: 'in_progress' }), leaf({ status: 'delayed' })]
    expect(delayedLeaves(ls)).toHaveLength(2)
  })
  it('dueSoonLeaves — 미완료 & 7일 내 마감(오늘 이후)', () => {
    const ls = [
      leaf({ status: 'in_progress', plannedEnd: '2026-07-10' }),   // D+2 ✓
      leaf({ status: 'in_progress', plannedEnd: '2026-07-20' }),   // D+12 ✗
      leaf({ status: 'done', plannedEnd: '2026-07-09' }),          // done ✗
      leaf({ status: 'in_progress', plannedEnd: '2026-07-01' }),   // 과거 ✗
      leaf({ status: 'in_progress', plannedEnd: null }),           // 날짜없음 ✗
    ]
    expect(dueSoonLeaves(ls, today)).toHaveLength(1)
  })
})

import { riskModel } from '@/lib/domain/dashboard'

const phase = (over: Partial<ComputedItem>): ComputedItem =>
  leaf({ level: 'phase', parentId: null, ...over })

describe('riskModel', () => {
  const today = '2026-07-08'
  it('지연 0 → green', () => {
    expect(riskModel([phase({ status: 'in_progress', children: [leaf({ status: 'in_progress' })] })], today).signal).toBe('green')
  })
  it('지연 1~3 → amber', () => {
    const r = phase({ weight: null, status: 'in_progress', children: [leaf({ status: 'delayed' }), leaf({ status: 'delayed' })] })
    expect(riskModel([r], today).signal).toBe('amber')
    expect(riskModel([r], today).delayed).toBe(2)
  })
  it('지연 4+ → red', () => {
    const r = phase({ children: Array.from({ length: 4 }, () => leaf({ status: 'delayed' })) })
    expect(riskModel([r], today).signal).toBe('red')
  })
  it('최상위 가중 Phase 지연 → 한 단계 격상(green→amber)', () => {
    // 지연 리프 0(→green)이지만 최상위 가중 Phase 자체가 delayed → amber
    const top = phase({ weight: 3, status: 'delayed', children: [leaf({ status: 'in_progress' })] })
    const other = phase({ weight: 1, status: 'in_progress', children: [leaf({ status: 'in_progress' })] })
    expect(riskModel([top, other], today).topWeightDelayed).toBe(true)
    expect(riskModel([top, other], today).signal).toBe('amber')
  })
  it('가중치 전부 null → 격상 없음', () => {
    const a = phase({ weight: null, status: 'delayed', children: [leaf({ status: 'in_progress' })] })
    expect(riskModel([a], today).topWeightDelayed).toBe(false)
    expect(riskModel([a], today).signal).toBe('green')
  })
})
