import { describe, it, expect } from 'vitest'
import { sheetLineText, cellLines, buildSheetNarrative } from '@/lib/report/sheetNarrative'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: 'ERP', module: 'SD/LE', sortOrder: 1,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('sheetLineText', () => {
  it('일반·숫자 줄은 4칸, 마커 추가 없음', () => {
    expect(sheetLineText('1. 현업 인터뷰 참석')).toBe('    1. 현업 인터뷰 참석')
    expect(sheetLineText('프로세스 분석')).toBe('    프로세스 분석')
  })
  it("'-' 줄은 8칸, '.' 줄은 12칸", () => {
    expect(sheetLineText('- 대상 : 영업팀')).toBe('        - 대상 : 영업팀')
    expect(sheetLineText('. 세부 검토')).toBe('            . 세부 검토')
  })
  it('이미 들여쓴 입력도 시작 문자로 판정', () => {
    expect(sheetLineText('  - 대상')).toBe('        - 대상')
  })
})

describe('cellLines', () => {
  it('줄 분해 + 연속 빈 줄 축약 + 앞뒤 빈 줄 제거', () => {
    expect(cellLines('1. A\n- a\n\n\n2. B\n')).toEqual(['1. A', '- a', '', '2. B'])
    expect(cellLines('\n\n1. A')).toEqual(['1. A'])
    expect(cellLines('')).toEqual([])
    expect(cellLines('   \n  ')).toEqual([])
  })
})

describe('buildSheetNarrative', () => {
  const rows = [
    row({ id: 'a', sortOrder: 2, section: 'MES', module: '가공', thisContent: '1. 인터뷰', nextContent: '' }),
    row({ id: 'b', sortOrder: 1, thisContent: '1. CheckList\n- CBO', thisIssue: '지연 위험', nextContent: '1. 계획', nextIssue: '일정 협의 필요\n추가 인력' }),
    row({ id: 'c', sortOrder: 3, section: '공통', module: '공통' }), // 4셀 모두 빈 행
  ]
  const n = buildSheetNarrative(rows)

  it('prev=금주실적, curr=차주계획 — 헤드라인 [구분] 모듈, sortOrder 순', () => {
    expect(n.prev.map(g => g.phase)).toEqual(['[ERP] SD/LE', '[MES] 가공'])
    expect(n.prev[0].items).toEqual(['1. CheckList', '- CBO'])
    expect(n.curr.map(g => g.phase)).toEqual(['[ERP] SD/LE']) // 가공은 차주 빈 셀 → 생략
  })
  it('빈 행은 어디에도 안 나감', () => {
    expect([...n.prev, ...n.curr].some(g => g.phase.includes('공통'))).toBe(false)
  })
  it('이슈: [모듈] 접두, 멀티라인은 줄마다 개별 항목', () => {
    expect(n.issues).toEqual(['[SD/LE] 지연 위험'])
    expect(n.events).toEqual(['[SD/LE] 일정 협의 필요', '[SD/LE] 추가 인력'])
  })
  it('이슈 없으면 [특이 이슈 없음] 직접 채움(우측 슬롯 기존 폴백 차단)', () => {
    const empty = buildSheetNarrative([row({ thisContent: '1. 작업' })])
    expect(empty.issues).toEqual(['특이 이슈 없음'])
    expect(empty.events).toEqual(['특이 이슈 없음'])
  })
})
