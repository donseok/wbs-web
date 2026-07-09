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
  it('나누어떨어지지 않으면 소수 1자리 유지', () => {
    // 7/6(월)~7/14(화) 7영업일, 오늘 7/8(수)=3영업일 → 3/7 = 42.857… → 42.9
    expect(plannedPct('2026-07-06', '2026-07-14', '2026-07-08', H)).toBe(42.9)
  })
})

describe('achievementOf', () => {
  it('실적/계획', () => { expect(achievementOf(40, 80)).toBe(50) })
  it('계획 0이면 null', () => { expect(achievementOf(0, 0)).toBeNull() })
  it('계획이 0.5 미만 소수여도 null(정수 기준) — 달성율 폭주 방지', () => {
    expect(achievementOf(45, 0.4)).toBeNull()
  })
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
  it('소수 입력도 정수 기준으로 판정(기존 의미 유지)', () => {
    // planned 0.3은 정수 기준 0 → not_started (delayed로 뒤집히지 않음)
    expect(statusOf(0, 0.3, '2026-07-06', '2026-07-08')).toBe('not_started')
    // 0.1%p 격차는 지연 아님 — 정수 표기 화면(33%/33%)과 모순되지 않게
    expect(statusOf(66.6, 66.7, '2026-07-06', '2026-07-08')).toBe('in_progress')
  })
  it('done은 원시값 기준 — 99.5는 반올림으로 완료 처리되지 않는다', () => {
    expect(statusOf(99.5, 50, '2026-07-06', '2026-07-08')).toBe('in_progress')
    expect(statusOf(100, 50, '2026-07-06', '2026-07-08')).toBe('done')
  })
})
