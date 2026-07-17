import { describe, it, expect } from 'vitest'
import { normalizeCellText, unifySheetRows } from '@/lib/domain/weeklyFormat'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

describe('normalizeCellText — 마커·번호·빈 줄 표준화(내용 불변)', () => {
  it('붙임 대시를 표준 하위 마커로', () => {
    expect(normalizeCellText('-CBO Program, Function, Table')).toBe('  -. CBO Program, Function, Table')
  })

  it('-. 들여쓰기 변형(0~5칸)을 2칸으로 고정', () => {
    for (const pad of ['', ' ', '   ', '     ']) {
      expect(normalizeCellText(`${pad}-. 대상 : 냉연생산`)).toBe('  -. 대상 : 냉연생산')
    }
  })

  it('상위 번호를 등장 순서대로 재부여하고 항목 사이 빈 줄 1개', () => {
    expect(normalizeCellText('1. A\n- a\n1. B\n- b')).toBe('1. A\n  -. a\n\n2. B\n  -. b')
  })

  it('1) (1) ① 마커를 N. 으로 통일', () => {
    expect(normalizeCellText('1) A\n(2) B\n③ C')).toBe('1. A\n\n2. B\n\n3. C')
  })

  it('붙여 쓴 1.내용 도 띄운다', () => {
    expect(normalizeCellText('1.내용')).toBe('1. 내용')
  })

  it('공백만 있는 줄·연속 빈 줄·앞뒤 빈 줄 정리(상위 항목 재배치와 결합)', () => {
    expect(normalizeCellText('\n1. A\n \n\n2. B\n  \n')).toBe('1. A\n\n2. B')
  })

  it('문장 내부는 한 글자도 바꾸지 않는다', () => {
    expect(normalizeCellText('-. 대상 : 냉연생산, 도금생산 ( F-MES)')).toBe('  -. 대상 : 냉연생산, 도금생산 ( F-MES)')
  })

  it('마커 없는 일반 줄은 그대로(줄 끝 공백만 제거)', () => {
    expect(normalizeCellText('검토 계속 진행 ')).toBe('검토 계속 진행')
  })

  it('빈 셀은 빈 셀', () => {
    expect(normalizeCellText('')).toBe('')
  })

  it('숫자로 시작하는 값(12.5%, -15%)을 마커로 오인하지 않는다', () => {
    expect(normalizeCellText('12.5% 달성')).toBe('12.5% 달성')
    expect(normalizeCellText('-15% 하락')).toBe('-15% 하락')
  })

  it('상위 항목이 없는 셀은 재배치 없이 연속 빈 줄만 축약', () => {
    expect(normalizeCellText('메모 A\n\n\n메모 B')).toBe('메모 A\n\n메모 B')
  })

  it('". " 3단계는 4칸 들여쓰기, 공백 없는 ".내용"은 일반 줄', () => {
    expect(normalizeCellText('. 세부')).toBe('    . 세부')
    expect(normalizeCellText('.내용')).toBe('.내용')
  })

  it('멱등성 — 실데이터 종합 픽스처: f(f(x)) === f(x)', () => {
    const messy = [
      '1. 현업 인터뷰 참석 ( 조업 )',
      '- 현 시스템 불편 및 개선 요청 사항 청취',
      ' ',
      '2. Program CheckList 점검 작업',
      '- CBO Program, Function, Table',
      '1. 현업 인터뷰 참석',
      '   -. 대상 : 냉연생산, 도금생산',
    ].join('\n')
    const once = normalizeCellText(messy)
    expect(normalizeCellText(once)).toBe(once)
    expect(once).toBe([
      '1. 현업 인터뷰 참석 ( 조업 )',
      '  -. 현 시스템 불편 및 개선 요청 사항 청취',
      '',
      '2. Program CheckList 점검 작업',
      '  -. CBO Program, Function, Table',
      '',
      '3. 현업 인터뷰 참석',
      '  -. 대상 : 냉연생산, 도금생산',
    ].join('\n'))
  })
})

describe('unifySheetRows — 바뀌는 셀만 edits로', () => {
  const row = (over: Partial<WeeklySheetRow>): WeeklySheetRow => ({
    id: 'a', reportId: 'r', section: 'PMO', module: '', sortOrder: 1,
    thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
  })

  it('변경 있는 셀만 before/after 쌍으로 반환하고, 이미 정상·빈 셀은 제외', () => {
    const rows = [
      row({ id: 'a', thisContent: '-메모', nextContent: '1. 계획' }), // nextContent는 이미 정상
      row({ id: 'b', section: '', module: 'SD/LE', thisIssue: '- 이슈' }), // 라벨은 모듈로 폴백
    ]
    expect(unifySheetRows(rows)).toEqual([
      { rowId: 'a', cellKey: 'this_content', section: 'PMO', before: '-메모', after: '  -. 메모' },
      { rowId: 'b', cellKey: 'this_issue', section: 'SD/LE', before: '- 이슈', after: '  -. 이슈' },
    ])
  })

  it('변경이 하나도 없으면 빈 배열', () => {
    expect(unifySheetRows([row({ thisContent: '1. 정상\n  -. 하위' })])).toEqual([])
  })
})
