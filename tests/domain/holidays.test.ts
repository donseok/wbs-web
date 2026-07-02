import { describe, it, expect } from 'vitest'
import { krSpecialDays, krSpecialDayMap, KR_HOLIDAY_TABLE_YEARS } from '@/lib/domain/holidays'

describe('krSpecialDays', () => {
  it('제헌절(7/17): 2025년까지 무휴 국경일(anniversary), 2026년부터 공휴일 재지정', () => {
    expect(krSpecialDayMap([2025]).get('2025-07-17')).toMatchObject({ kind: 'anniversary', name: 'jeheonjeol' })
    expect(krSpecialDayMap([2026]).get('2026-07-17')).toMatchObject({ kind: 'holiday', name: 'jeheonjeol' })
    // 2027년 제헌절은 토요일 → 대체공휴일 7/19
    expect(krSpecialDayMap([2027]).get('2027-07-19')?.kind).toBe('substitute')
  })

  it('2026년 설 연휴 3일 + 삼일절 대체공휴일', () => {
    const map = krSpecialDayMap([2026])
    expect(map.get('2026-02-16')?.name).toBe('seollal')
    expect(map.get('2026-02-17')?.name).toBe('seollal')
    expect(map.get('2026-02-18')?.name).toBe('seollal')
    expect(map.get('2026-03-01')?.name).toBe('samiljeol')
    expect(map.get('2026-03-02')).toMatchObject({ kind: 'substitute', name: 'substitute' })
  })

  it('2026년 광복절(토)·개천절(토) 대체공휴일', () => {
    const map = krSpecialDayMap([2026])
    expect(map.get('2026-08-17')?.kind).toBe('substitute')
    expect(map.get('2026-10-05')?.kind).toBe('substitute')
  })

  it('2025년 추석 연휴 + 대체공휴일(10/8) + 임시공휴일(1/27)', () => {
    const map = krSpecialDayMap([2025])
    expect(map.get('2025-10-06')?.name).toBe('chuseok')
    expect(map.get('2025-10-08')?.kind).toBe('substitute')
    expect(map.get('2025-01-27')?.name).toBe('tempHoliday')
  })

  it('같은 날 특일 겹침(2025-05-05 어린이날+부처님오신날)은 1건으로 병합', () => {
    const days = krSpecialDays(2025)
    const may5 = days.filter(d => d.date === '2025-05-05')
    expect(may5).toHaveLength(1)
    expect(may5[0].kind).toBe('holiday')
  })

  it('5/1: 2025년까지 근로자의날(anniversary), 2026년부터 노동절 공휴일', () => {
    expect(krSpecialDayMap([2025]).get('2025-05-01')).toMatchObject({ kind: 'anniversary', name: 'workersDay' })
    expect(krSpecialDayMap([2026]).get('2026-05-01')).toMatchObject({ kind: 'holiday', name: 'laborDay' })
    // 2027년 노동절은 토요일 → 대체공휴일 5/3
    expect(krSpecialDayMap([2027]).get('2027-05-03')?.kind).toBe('substitute')
  })

  it('2028년 설 연휴는 1/26(수)~1/28(금)', () => {
    const map = krSpecialDayMap([2028])
    expect(map.get('2028-01-25')).toBeUndefined()
    expect(map.get('2028-01-26')?.name).toBe('seollal')
    expect(map.get('2028-01-28')?.name).toBe('seollal')
  })

  it('테이블 밖 연도는 양력 고정 특일만 폴백 (음력 특일 없음)', () => {
    const fallbackYear = Math.max(...KR_HOLIDAY_TABLE_YEARS) + 5
    const days = krSpecialDays(fallbackYear)
    // 2026년 이후이므로 제헌절·노동절은 공휴일
    expect(days.find(d => d.date === `${fallbackYear}-07-17`)).toMatchObject({ kind: 'holiday', name: 'jeheonjeol' })
    expect(days.find(d => d.date === `${fallbackYear}-05-01`)?.name).toBe('laborDay')
    expect(days.find(d => d.date === `${fallbackYear}-01-01`)?.name).toBe('newYear')
    expect(days.some(d => d.name === 'seollal' || d.name === 'chuseok' || d.name === 'buddha')).toBe(false)
  })

  it('날짜 형식과 정렬 보장', () => {
    for (const y of KR_HOLIDAY_TABLE_YEARS) {
      const days = krSpecialDays(y)
      for (const d of days) expect(d.date).toMatch(new RegExp(`^${y}-\\d{2}-\\d{2}$`))
      const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1))
      expect(days.map(d => d.date)).toEqual(sorted.map(d => d.date))
    }
  })
})

describe('krSpecialDayMap', () => {
  it('여러 연도를 합쳐 연도 경계 그리드 조회를 지원', () => {
    const map = krSpecialDayMap([2025, 2026])
    expect(map.get('2025-12-25')?.name).toBe('christmas')
    expect(map.get('2026-01-01')?.name).toBe('newYear')
  })

  it('중복 연도 입력은 무해', () => {
    const map = krSpecialDayMap([2026, 2026, 2026])
    expect(map.get('2026-07-17')?.name).toBe('jeheonjeol')
  })
})
