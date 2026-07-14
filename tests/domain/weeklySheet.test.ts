import { describe, it, expect } from 'vitest'
import {
  carryOverRows, applyServerRow, defaultWeeklyRows, isWeeklyCellKey, mapLegacySection, moduleOptions,
  WEEKLY_MODULES, WEEKLY_SECTIONS, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: 'ERP', module: 'SD/LE', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('mapLegacySection', () => {
  it('구 분류(공통/ERP/MES × 모듈) → 신규 구분', () => {
    expect(mapLegacySection('공통', '공통')).toBe('공통')
    expect(mapLegacySection('ERP', 'SD/LE')).toBe('영업')
    expect(mapLegacySection('ERP', 'MD/PP')).toBe('생산계획')
    expect(mapLegacySection('ERP', 'MM')).toBe('구매')
    expect(mapLegacySection('ERP', 'FI/TR')).toBe('관리회계')
    expect(mapLegacySection('ERP', 'CO')).toBe('관리회계')
    expect(mapLegacySection('MES', '품질')).toBe('품질')
    expect(mapLegacySection('MES', 'APS')).toBe('생산계획')
    expect(mapLegacySection('MES', '조업 및 표준화')).toBe('조업 및 표준화')
    expect(mapLegacySection('MES', '가공')).toBe('Luxteel 가공')
    expect(mapLegacySection('MES', '설비 Level2')).toBe('설비 및 Level2')
    expect(mapLegacySection('MES', '물류')).toBe('물류')
  })
  it('이미 신규 구분이면 항등 — 신규 행은 module이 빈 문자열', () => {
    for (const s of WEEKLY_SECTIONS) expect(mapLegacySection(s, '')).toBe(s)
  })
  it('매핑 불가(자유 입력·모듈 없는 레거시) → 공통으로 흡수', () => {
    expect(mapLegacySection('기타', '알수없음')).toBe('공통')
    expect(mapLegacySection('MES', '')).toBe('공통')
    expect(mapLegacySection('', '')).toBe('공통')
  })
})

describe('carryOverRows', () => {
  it('신규 체계 시트 — 차주계획→금주실적 1:1 이월, next는 비움, 10행 유지', () => {
    const prev = [
      row({ id: 'a', sortOrder: 2, section: '영업', module: '', nextContent: '계획B', nextIssue: '이슈B' }),
      row({ id: 'b', sortOrder: 1, section: '공통', module: '', thisContent: '지난실적', nextContent: '계획A' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(10)
    expect(out.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(out[0]).toMatchObject({ section: '공통', thisContent: '계획A', thisIssue: '', nextContent: '', nextIssue: '' })
    expect(out[1]).toMatchObject({ section: '영업', thisContent: '계획B', thisIssue: '이슈B', nextContent: '', nextIssue: '' })
    expect('id' in out[0]).toBe(false)
  })
  it('레거시 시트 — 신규 구분으로 정규화, 같은 구분에 모이면 줄바꿈으로 병합', () => {
    const prev = [
      row({ id: 'a', sortOrder: 1, section: 'ERP', module: 'FI/TR', nextContent: '자금 계획' }),
      row({ id: 'b', sortOrder: 2, section: 'ERP', module: 'CO', nextContent: '원가 계획', nextIssue: '기준 미정' }),
      row({ id: 'c', sortOrder: 3, section: 'MES', module: '가공', nextContent: 'Luxteel 라인 점검' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(10)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('관리회계').thisContent).toBe('자금 계획\n원가 계획') // sortOrder 순으로 이어붙임
    expect(by('관리회계').thisIssue).toBe('기준 미정')
    expect(by('Luxteel 가공').thisContent).toBe('Luxteel 라인 점검')
    expect(by('영업').thisContent).toBe('')                         // 원본에 없던 구분은 빈 행
  })
  it('빈 입력 → 빈 표준 10행(빈 배열 아님)', () => {
    const out = carryOverRows([])
    expect(out).toHaveLength(10)
    expect(out.every(r => r.thisContent === '' && r.nextContent === '')).toBe(true)
  })
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
  it('업무영역 10행 — 구분 순서 보존, sortOrder 1부터 연속, module은 빈값', () => {
    expect(rows).toHaveLength(10)
    expect(rows.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(rows.map(r => r.sortOrder)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
    expect(rows.every(r => r.module === '')).toBe(true)
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
