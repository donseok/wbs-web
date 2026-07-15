import { describe, it, expect } from 'vitest'
import { sheetLineText, cellLines, rowLabel, buildSheetSections } from '@/lib/report/sheetNarrative'
import { WEEKLY_SECTIONS, type WeeklySheetRow } from '@/lib/domain/weeklySheet'

const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
  id: 'r1', reportId: 'rep1', section: '영업', module: '', sortOrder: 1,
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

describe('rowLabel', () => {
  it('신규 행(module 없음) — 구분명 단독', () => {
    expect(rowLabel(row({ section: '영업', module: '' }))).toBe('영업')
    expect(rowLabel(row({ section: '설비 및 Level2', module: '' }))).toBe('설비 및 Level2')
  })
  it('레거시 행 — 구분 · 모듈 병기', () => {
    expect(rowLabel(row({ section: 'ERP', module: 'SD/LE' }))).toBe('ERP · SD/LE')
    expect(rowLabel(row({ section: '공통', module: '공통' }))).toBe('공통') // 같으면 중복 표기 안 함
  })
  it('구분 없는 행 — 모듈 폴백, 둘 다 없으면 기타', () => {
    expect(rowLabel(row({ section: '', module: '물류' }))).toBe('물류')
    expect(rowLabel(row({ section: '', module: '' }))).toBe('기타')
  })
})

describe('보고 순서', () => {
  it('시트 행 순서와 PPT 보고 순서는 WEEKLY_SECTIONS 하나로 정의된다(PMO 선두)', () => {
    expect(WEEKLY_SECTIONS).toEqual([
      'PMO', '영업', '구매', '관리회계', '품질', '생산계획', '조업및표준화', '물류', '설비및L2', '가공',
    ])
    expect(WEEKLY_SECTIONS.indexOf('PMO')).toBeLessThan(WEEKLY_SECTIONS.indexOf('영업')) // PMO가 영업 위
  })
})

describe('buildSheetSections', () => {
  const rows = [
    row({ id: 'a', sortOrder: 2, section: '품질', thisContent: '1. 인터뷰', nextContent: '' }),
    row({ id: 'b', sortOrder: 1, section: '영업', thisContent: '1. CheckList\n- CBO', thisIssue: '지연 위험', nextContent: '1. 계획', nextIssue: '일정 협의 필요\n추가 인력' }),
    row({ id: 'c', sortOrder: 3, section: '구매' }), // 4셀 모두 빈 행
  ]
  const secs = buildSheetSections(rows)
  const byName = (name: string) => secs.find(s => s.section === name)!

  it('표준 10구분을 전부 WEEKLY_SECTIONS 순서로 포함한다(내용 없는 구분 포함, PMO 선두)', () => {
    expect(secs.map(s => s.section)).toEqual([...WEEKLY_SECTIONS])
    expect(secs[0].section).toBe('PMO')
  })
  it('각 구분에 4셀(실적·계획·이슈·이벤트)이 함께 담긴다', () => {
    const s = byName('영업')
    expect(s.thisContent).toEqual(['1. CheckList', '- CBO'])
    expect(s.nextContent).toEqual(['1. 계획'])
    expect(s.thisIssue).toEqual(['지연 위험'])
    expect(s.nextIssue).toEqual(['일정 협의 필요', '추가 인력']) // 멀티라인은 줄마다 개별 항목
  })
  it('내용 없는 구분도 빈 4셀로 남는다(빈 페이지 소스)', () => {
    const s = byName('구매')
    expect(s.thisContent).toEqual([])
    expect(s.nextContent).toEqual([])
    expect(s.thisIssue).toEqual([])
    expect(s.nextIssue).toEqual([])
  })
  it('구분명으로 정렬 — 행의 sortOrder가 뒤죽박죽이어도 보고 순서 유지', () => {
    const shuffled = [...WEEKLY_SECTIONS].reverse().map((section, i) =>
      row({ id: `r${i}`, sortOrder: i + 1, section, thisContent: `${section} 실적` }))
    expect(buildSheetSections(shuffled).map(s => s.section)).toEqual([...WEEKLY_SECTIONS])
  })
  it('비표준 구분(레거시·자유 입력)은 표준 10구분 뒤에, 서로는 sortOrder 순', () => {
    const built = buildSheetSections([
      row({ id: 'x', sortOrder: 1, section: 'ERP', module: 'SD/LE', thisContent: '레거시B' }),
      row({ id: 'z', sortOrder: 0, section: '기타', module: '', thisContent: '레거시A' }),
    ])
    expect(built.slice(0, WEEKLY_SECTIONS.length).map(s => s.section)).toEqual([...WEEKLY_SECTIONS])
    expect(built.slice(WEEKLY_SECTIONS.length).map(s => s.section)).toEqual(['기타', 'ERP · SD/LE'])
    expect(built.find(s => s.section === 'ERP · SD/LE')!.thisContent).toEqual(['레거시B'])
  })
  it('같은 구분의 여러 행은 sortOrder 순으로 이어붙이고 사이에 빈 줄 1개', () => {
    const built = buildSheetSections([
      row({ id: 'p', sortOrder: 2, section: '관리회계', thisContent: 'CO 실적', thisIssue: 'CO 이슈' }),
      row({ id: 'q', sortOrder: 1, section: '관리회계', thisContent: 'FI 실적', thisIssue: 'FI 이슈' }),
    ])
    const s = built.find(x => x.section === '관리회계')!
    expect(s.thisContent).toEqual(['FI 실적', '', 'CO 실적']) // 빈 줄 구분
    expect(s.thisIssue).toEqual(['FI 이슈', 'CO 이슈'])        // 이슈는 빈 줄 없이 flatten
  })
})
