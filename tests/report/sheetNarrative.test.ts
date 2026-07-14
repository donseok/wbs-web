import { describe, it, expect } from 'vitest'
import { sheetLineText, cellLines, rowLabel, buildSheetNarrative } from '@/lib/report/sheetNarrative'
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
  it('시트 행 순서와 PPT 보고 순서는 WEEKLY_SECTIONS 하나로 정의된다', () => {
    expect(WEEKLY_SECTIONS).toEqual([
      '영업', '구매', '관리회계', '품질', '생산계획', '조업및표준화', '물류', '설비및L2', '가공',
    ])
  })
})

describe('buildSheetNarrative', () => {
  const rows = [
    row({ id: 'a', sortOrder: 2, section: '품질', thisContent: '1. 인터뷰', nextContent: '' }),
    row({ id: 'b', sortOrder: 1, section: '영업', thisContent: '1. CheckList\n- CBO', thisIssue: '지연 위험', nextContent: '1. 계획', nextIssue: '일정 협의 필요\n추가 인력' }),
    row({ id: 'c', sortOrder: 3, section: '구매' }), // 4셀 모두 빈 행
  ]
  const n = buildSheetNarrative(rows)

  it('prev=금주실적, curr=차주계획 — 헤드라인은 구분명', () => {
    expect(n.prev.map(g => g.phase)).toEqual(['영업', '품질'])
    expect(n.prev[0].items).toEqual(['1. CheckList', '- CBO'])
    expect(n.curr.map(g => g.phase)).toEqual(['영업']) // 품질은 차주 빈 셀 → 생략
  })
  it('그룹·이슈 모두 보고 순서를 따른다 — 행의 sortOrder가 뒤죽박죽이어도', () => {
    const shuffled = [...WEEKLY_SECTIONS].reverse().map((section, i) =>
      row({ id: `r${i}`, sortOrder: i + 1, section, thisContent: `${section} 실적`, thisIssue: `${section} 이슈` }))
    const built = buildSheetNarrative(shuffled)
    expect(built.prev.map(g => g.phase)).toEqual([...WEEKLY_SECTIONS])
    expect(built.issues).toEqual(WEEKLY_SECTIONS.map(s => `[${s}] ${s} 이슈`))
  })
  it('보고 순서에 없는 구분(레거시·자유 입력)은 뒤로 밀되 서로는 sortOrder 순을 지킨다', () => {
    const built = buildSheetNarrative([
      row({ id: 'x', sortOrder: 1, section: 'ERP', module: 'SD/LE', thisContent: '레거시B' }),
      row({ id: 'y', sortOrder: 2, section: '구매', thisContent: '구매 실적' }),
      row({ id: 'z', sortOrder: 0, section: '기타', module: '', thisContent: '레거시A' }),
    ])
    expect(built.prev.map(g => g.phase)).toEqual(['구매', '기타', 'ERP · SD/LE'])
  })
  it('내용 없는 구분은 어디에도 안 나감', () => {
    expect([...n.prev, ...n.curr].some(g => g.phase.includes('구매'))).toBe(false)
  })
  it('이슈: [구분] 접두, 멀티라인은 줄마다 개별 항목', () => {
    expect(n.issues).toEqual(['[영업] 지연 위험'])
    expect(n.events).toEqual(['[영업] 일정 협의 필요', '[영업] 추가 인력'])
  })
  it('이슈 없으면 [특이 이슈 없음] 직접 채움(우측 슬롯 기존 폴백 차단)', () => {
    const empty = buildSheetNarrative([row({ thisContent: '1. 작업' })])
    expect(empty.issues).toEqual(['특이 이슈 없음'])
    expect(empty.events).toEqual(['특이 이슈 없음'])
  })
  it('레거시 시트 — 헤드라인·이슈 접두에 구분 · 모듈 병기', () => {
    const legacy = buildSheetNarrative([
      row({ section: 'ERP', module: 'SD/LE', thisContent: '1. 수주 프로세스', thisIssue: '보류 건 있음' }),
    ])
    expect(legacy.prev.map(g => g.phase)).toEqual(['ERP · SD/LE'])
    expect(legacy.issues).toEqual(['[ERP · SD/LE] 보류 건 있음'])
  })
  it('구분·모듈 빈 행(무라벨) — "[] " 미노출', () => {
    const unlabeled = buildSheetNarrative([
      row({ section: '', module: '', thisContent: '1. 통관 프로세스', thisIssue: '보세공장 이슈' }),
    ])
    expect(unlabeled.prev.map(g => g.phase)).toEqual(['기타'])
    expect(unlabeled.issues).toEqual(['[기타] 보세공장 이슈'])
  })
})
