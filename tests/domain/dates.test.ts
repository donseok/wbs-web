import { describe, it, expect } from 'vitest'
import {
  addDaysIso,
  businessDaysBetween,
  isBusinessDay,
  isWeekendDow,
  seoulStamp,
  seoulToday,
  seoulYmd,
} from '@/lib/domain/dates'

describe('isBusinessDay', () => {
  it('주말은 영업일 아님', () => {
    expect(isBusinessDay('2026-07-04', new Set())).toBe(false) // 토
    expect(isBusinessDay('2026-07-05', new Set())).toBe(false) // 일
  })
  it('평일은 영업일', () => {
    expect(isBusinessDay('2026-07-06', new Set())).toBe(true)  // 월
  })
  it('공휴일은 영업일 아님', () => {
    expect(isBusinessDay('2026-07-17', new Set(['2026-07-17']))).toBe(false)
  })
})

describe('businessDaysBetween', () => {
  it('월~금 5영업일 (양끝 포함)', () => {
    expect(businessDaysBetween('2026-07-06', '2026-07-10', new Set())).toBe(5)
  })
  it('주말 포함 한 주는 5', () => {
    expect(businessDaysBetween('2026-07-06', '2026-07-12', new Set())).toBe(5)
  })
  it('공휴일(7/17 제헌절) 제외', () => {
    // 7/13(월)~7/17(금) 중 7/17 공휴일 → 4
    expect(businessDaysBetween('2026-07-13', '2026-07-17', new Set(['2026-07-17']))).toBe(4)
  })
  it('end<start면 0', () => {
    expect(businessDaysBetween('2026-07-10', '2026-07-06', new Set())).toBe(0)
  })
})

describe('isWeekendDow', () => {
  it('일(0)·토(6)는 주말', () => {
    expect(isWeekendDow(0)).toBe(true)
    expect(isWeekendDow(6)).toBe(true)
  })
  it('월~금(1~5)은 평일', () => {
    expect(isWeekendDow(1)).toBe(false)
    expect(isWeekendDow(2)).toBe(false)
    expect(isWeekendDow(3)).toBe(false)
    expect(isWeekendDow(4)).toBe(false)
    expect(isWeekendDow(5)).toBe(false)
  })
})

describe('seoulToday', () => {
  it("'YYYY-MM-DD' 형식 문자열을 돌려준다", () => {
    expect(seoulToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('seoulYmd', () => {
  it('UTC 와 서울 날짜가 갈리는 15:00Z 는 서울 기준 다음 날', () => {
    // UTC 로는 8/18, KST(+9) 로는 8/19 — 이 경계를 UTC 로 자르면 하루가 밀린다
    expect(seoulYmd(new Date('2026-08-18T15:00:00Z'))).toBe('2026-08-19')
  })
  it('14:59:59Z 는 아직 서울 같은 날', () => {
    expect(seoulYmd(new Date('2026-08-18T14:59:59Z'))).toBe('2026-08-18')
  })
  it('UTC 자정은 서울 기준 같은 날 오전 9시라 날짜가 같다', () => {
    expect(seoulYmd(new Date('2026-08-18T00:00:00Z'))).toBe('2026-08-18')
  })
})

describe('seoulStamp', () => {
  // hour12:false 를 ICU 가 h24 로 해석하면 자정이 '24:00' 으로 새는데,
  // 그때 날짜까지 하루 어긋나 보고서·메일 스탬프가 통째로 틀린다. 로케일 교체 회귀 방지.
  it('서울 자정은 24:00 이 아니라 00:00 이고 날짜는 다음 날', () => {
    expect(seoulStamp(new Date('2026-08-18T15:00:00Z'))).toBe('2026-08-19 00:00')
  })
  it('자정 1분 전은 같은 날 23:59', () => {
    expect(seoulStamp(new Date('2026-08-18T14:59:00Z'))).toBe('2026-08-18 23:59')
  })
  it('문자열 인자 오버로드는 Date 인자와 같은 결과', () => {
    expect(seoulStamp('2026-08-18T15:00:00Z')).toBe('2026-08-19 00:00')
  })
  it('오전/오후 접미 없이 24시간제 두 자리로 채운다', () => {
    expect(seoulStamp(new Date('2026-01-01T03:05:00Z'))).toBe('2026-01-01 12:05')
  })
})

describe('addDaysIso', () => {
  it('월 경계를 넘긴다', () => {
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01')
  })
  it('연 경계를 넘긴다', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('음수 델타는 뒤로 간다(월 경계)', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('음수 델타는 뒤로 간다(연 경계)', () => {
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('윤년 2월 29일을 만든다', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('평년 2월은 28일에서 3월로 넘어간다', () => {
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01')
  })
  it('0일은 그대로', () => {
    expect(addDaysIso('2026-08-18', 0)).toBe('2026-08-18')
  })
  it('한 자리 월·일은 zero-pad 된다', () => {
    expect(addDaysIso('2026-08-30', 3)).toBe('2026-09-02')
  })
})
