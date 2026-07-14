import { describe, it, expect } from 'vitest'
import {
  carryOverRows, applyServerRow, defaultWeeklyRows, isWeeklyCellKey, mapLegacySection,
  WEEKLY_CELL_MAX, WEEKLY_SECTIONS, type WeeklySheetRow,
} from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: 'ERP', module: 'SD/LE', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('mapLegacySection', () => {
  it('구 분류(공통/ERP/MES × 모듈) → 신규 구분', () => {
    expect(mapLegacySection('ERP', 'SD/LE')).toBe('영업')
    expect(mapLegacySection('ERP', 'MD/PP')).toBe('생산계획')
    expect(mapLegacySection('ERP', 'MM')).toBe('구매')
    expect(mapLegacySection('ERP', 'FI/TR')).toBe('관리회계')
    expect(mapLegacySection('ERP', 'CO')).toBe('관리회계')
    expect(mapLegacySection('MES', '품질')).toBe('품질')
    expect(mapLegacySection('MES', 'APS')).toBe('생산계획')
    expect(mapLegacySection('MES', '조업 및 표준화')).toBe('조업및표준화')
    expect(mapLegacySection('MES', '가공')).toBe('가공')
    expect(mapLegacySection('MES', '설비 Level2')).toBe('설비및L2')
    expect(mapLegacySection('MES', '물류')).toBe('물류')
  })
  it('이미 신규 구분이면 항등 — 신규 행은 module이 빈 문자열', () => {
    for (const s of WEEKLY_SECTIONS) expect(mapLegacySection(s, '')).toBe(s)
  })
  it('매핑 불가(자유 입력·모듈 없는 레거시) → 첫 구분으로 흡수(내용 유실 방지)', () => {
    const fb = WEEKLY_SECTIONS[0]
    expect(mapLegacySection('기타', '알수없음')).toBe(fb)
    expect(mapLegacySection('MES', '')).toBe(fb)
    expect(mapLegacySection('', '')).toBe(fb)
  })
  it('Object.prototype 상속 키도 흡수 — 매핑표 조회가 프로토타입 체인을 타지 않는다', () => {
    for (const k of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(mapLegacySection('ERP', k)).toBe(WEEKLY_SECTIONS[0])
      expect(mapLegacySection(k, '')).toBe(WEEKLY_SECTIONS[0])
    }
  })
})

describe('carryOverRows', () => {
  it('신규 체계 시트 — 차주계획→금주실적 1:1 이월, next는 비움, 9행 유지', () => {
    const prev = [
      row({ id: 'a', sortOrder: 2, section: '구매', module: '', nextContent: '계획B', nextIssue: '이슈B' }),
      row({ id: 'b', sortOrder: 1, section: '영업', module: '', thisContent: '지난실적', nextContent: '계획A' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(9)
    expect(out.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(out[0]).toMatchObject({ section: '영업', thisContent: '계획A', thisIssue: '', nextContent: '', nextIssue: '' })
    expect(out[1]).toMatchObject({ section: '구매', thisContent: '계획B', thisIssue: '이슈B', nextContent: '', nextIssue: '' })
    expect('id' in out[0]).toBe(false)
  })
  it('레거시 시트 — 신규 구분으로 정규화, 같은 구분에 모이면 줄바꿈으로 병합', () => {
    const prev = [
      row({ id: 'a', sortOrder: 1, section: 'ERP', module: 'FI/TR', nextContent: '자금 계획' }),
      row({ id: 'b', sortOrder: 2, section: 'ERP', module: 'CO', nextContent: '원가 계획', nextIssue: '기준 미정' }),
      row({ id: 'c', sortOrder: 3, section: 'MES', module: '가공', nextContent: 'Luxteel 라인 점검' }),
    ]
    const out = carryOverRows(prev)
    expect(out).toHaveLength(9)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('관리회계').thisContent).toBe('자금 계획\n원가 계획') // sortOrder 순으로 이어붙임
    expect(by('관리회계').thisIssue).toBe('기준 미정')
    expect(by('가공').thisContent).toBe('Luxteel 라인 점검')
    expect(by('품질').thisContent).toBe('')                         // 원본에 없던 구분은 빈 행
  })
  it('빈 입력 → 빈 표준 9행(빈 배열 아님)', () => {
    const out = carryOverRows([])
    expect(out).toHaveLength(9)
    expect(out.every(r => r.thisContent === '' && r.nextContent === '')).toBe(true)
  })
  it('병합 시 앞뒤 빈 줄을 다듬는다 — PPT에 빈 불릿이 찍히지 않게', () => {
    const prev = [
      row({ id: 'a', sortOrder: 1, section: 'ERP', module: 'FI/TR', nextContent: '1. 자금 계획\n\n' }),
      row({ id: 'b', sortOrder: 2, section: 'ERP', module: 'CO', nextContent: '\n1. 원가 계획' }),
      row({ id: 'c', sortOrder: 3, section: 'MES', module: '물류', nextContent: '\n\n1. 통관\n' }),
    ]
    const out = carryOverRows(prev)
    const by = (s: string) => out.find(r => r.section === s)!
    expect(by('관리회계').thisContent).toBe('1. 자금 계획\n1. 원가 계획') // 빈 줄 없이 정확히 두 줄
    expect(by('물류').thisContent).toBe('1. 통관')                        // 단독 값도 앞뒤 개행 제거
  })
  it('셀 내부의 문단 구분 빈 줄은 보존한다 — 다듬는 건 앞뒤뿐', () => {
    const prev = [row({ sortOrder: 1, section: '영업', module: '', nextContent: '1. A\n\n2. B' })]
    expect(carryOverRows(prev).find(r => r.section === '영업')!.thisContent).toBe('1. A\n\n2. B')
  })
  it('상속 키 모듈(toString 등)도 내용을 버리지 않고 흡수', () => {
    const prev = [row({ sortOrder: 1, section: 'ERP', module: 'toString', nextContent: '1. 잃으면 안 되는 내용' })]
    const out = carryOverRows(prev)
    expect(out.find(r => r.section === WEEKLY_SECTIONS[0])!.thisContent).toBe('1. 잃으면 안 되는 내용')
  })
  it('병합 결과가 셀 상한을 넘지 않게 클램프 — 넘치면 저장 불가 셀이 시드된다', () => {
    const half = 'x'.repeat(WEEKLY_CELL_MAX - 10)
    const prev = [
      row({ id: 'a', sortOrder: 1, section: 'ERP', module: 'FI/TR', nextContent: half }),
      row({ id: 'b', sortOrder: 2, section: 'ERP', module: 'CO', nextContent: half }),
    ]
    const merged = carryOverRows(prev).find(r => r.section === '관리회계')!.thisContent
    expect(merged.length).toBeLessThanOrEqual(WEEKLY_CELL_MAX)
    expect(merged.startsWith(half)).toBe(true) // 앞부분은 보존
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

describe('defaultWeeklyRows', () => {
  const rows = defaultWeeklyRows()
  it('업무영역 9행 — 구분 순서 보존, sortOrder 1부터 연속, module은 빈값', () => {
    expect(rows).toHaveLength(9)
    expect(rows.map(r => r.section)).toEqual([...WEEKLY_SECTIONS])
    expect(rows.map(r => r.sortOrder)).toEqual(Array.from({ length: 9 }, (_, i) => i + 1))
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
