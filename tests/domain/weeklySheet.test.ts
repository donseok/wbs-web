import { describe, it, expect } from 'vitest'
import {
  carryOverRows, applyServerRow, defaultWeeklyRows, isWeeklyCellKey, moduleOptions,
  WEEKLY_MODULES, WEEKLY_SECTIONS, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: 'ERP', module: 'SD/LE', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('carryOverRows', () => {
  it('차주계획→금주실적 이월, next는 비움, 행 구성·순서 보존', () => {
    const prev = [
      row({ id: 'a', sortOrder: 2, module: 'MM', nextContent: '계획B', nextIssue: '이슈B' }),
      row({ id: 'b', sortOrder: 1, thisContent: '지난실적', nextContent: '계획A' }),
    ]
    const out = carryOverRows(prev)
    expect(out.map(r => r.module)).toEqual(['SD/LE', 'MM']) // sortOrder 정렬
    expect(out[0]).toMatchObject({ sortOrder: 1, thisContent: '계획A', thisIssue: '', nextContent: '', nextIssue: '' })
    expect(out[1]).toMatchObject({ sortOrder: 2, thisContent: '계획B', thisIssue: '이슈B', nextContent: '', nextIssue: '' })
    expect('id' in out[0]).toBe(false)
  })
  it('빈 입력 → 빈 배열', () => expect(carryOverRows([])).toEqual([]))
})

describe('applyServerRow', () => {
  const local = row({ thisContent: '입력중(dirty)', nextContent: '로컬낡음' })
  const server = row({ thisContent: '서버값1', nextContent: '서버값2', module: '변경모듈' })
  it('dirty 셀은 로컬 유지, 나머지는 서버 채택(구조 필드 포함)', () => {
    const merged = applyServerRow(local, server, new Set(['r1:this_content']))
    expect(merged.thisContent).toBe('입력중(dirty)')
    expect(merged.nextContent).toBe('서버값2')
    expect(merged.module).toBe('변경모듈')
  })
  it('dirty 없으면 서버 그대로', () => {
    expect(applyServerRow(local, server, new Set())).toEqual(server)
  })
})

describe('moduleOptions', () => {
  it('구분별 목록을 그대로 반환', () => {
    expect(moduleOptions('ERP')).toEqual(['SD/LE', 'MD/PP', 'MM', 'FI/TR', 'CO'])
    expect(moduleOptions('공통')).toEqual(['공통'])
  })
  it('미지의 구분 → 전체 모듈 평탄화', () => {
    expect(moduleOptions('설비')).toEqual(Object.values(WEEKLY_MODULES).flat())
  })
  it('목록에 없는 current는 선두에 포함, 있으면 중복 없음', () => {
    expect(moduleOptions('ERP', '커스텀')).toEqual(['커스텀', 'SD/LE', 'MD/PP', 'MM', 'FI/TR', 'CO'])
    expect(moduleOptions('ERP', 'MM')).toEqual(['SD/LE', 'MD/PP', 'MM', 'FI/TR', 'CO'])
  })
})

describe('defaultWeeklyRows', () => {
  const rows = defaultWeeklyRows()
  it('표준 분류 12행 — 구분·모듈 순서 보존, sortOrder 1부터 연속', () => {
    expect(rows).toHaveLength(12)
    expect(rows.map(r => r.sortOrder)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(rows[0]).toMatchObject({ section: '공통', module: '공통' })
    expect(rows.filter(r => r.section === 'ERP').map(r => r.module)).toEqual([...WEEKLY_MODULES.ERP])
    expect(rows.filter(r => r.section === 'MES').map(r => r.module)).toEqual([...WEEKLY_MODULES.MES])
    expect([...new Set(rows.map(r => r.section))]).toEqual([...WEEKLY_SECTIONS])
  })
  it('셀 4개는 모두 빈값', () => {
    for (const r of rows) expect(r.thisContent + r.thisIssue + r.nextContent + r.nextIssue).toBe('')
  })
})

describe('isWeeklyCellKey', () => {
  it('화이트리스트만 통과', () => {
    expect(isWeeklyCellKey('this_content')).toBe(true)
    expect(isWeeklyCellKey('next_issue')).toBe(true)
    expect(isWeeklyCellKey('section')).toBe(false)     // 구조 필드는 셀 저장 경로로 못 바꿈
    expect(isWeeklyCellKey('id; drop table')).toBe(false)
  })
})
