import { describe, it, expect } from 'vitest'
import { serializeTsv, parseTsv } from '@/lib/domain/sheetClipboard'

describe('serializeTsv', () => {
  it('단순 격자 — 탭·개행 구분', () => {
    expect(serializeTsv([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td')
  })
  it('탭·개행·따옴표 포함 셀만 인용', () => {
    expect(serializeTsv([['plain', 'a\tb']])).toBe('plain\t"a\tb"')
    expect(serializeTsv([['줄1\n줄2']])).toBe('"줄1\n줄2"')
    expect(serializeTsv([['a\rb']])).toBe('"a\rb"')
  })
  it('내부 따옴표는 "" 로 이스케이프', () => {
    expect(serializeTsv([['그는 "확인"함']])).toBe('"그는 ""확인""함"')
    expect(serializeTsv([['"']])).toBe('""""')
  })
  it('빈 셀은 그대로(인용 안 함)', () => {
    expect(serializeTsv([['a', '', 'b']])).toBe('a\t\tb')
  })
})

describe('parseTsv', () => {
  it('단순 격자', () => {
    expect(parseTsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('후행 개행 1개는 빈 행을 만들지 않는다(엑셀/시트 복사본 말미)', () => {
    expect(parseTsv('a\tb\n')).toEqual([['a', 'b']])
    expect(parseTsv('a\tb\r\n')).toEqual([['a', 'b']]) // 엑셀 CRLF
  })
  it('\\r\\n·단독 \\r을 행 경계로 정규화', () => {
    expect(parseTsv('a\r\nb')).toEqual([['a'], ['b']])
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']]) // old-mac 단독 CR
  })
  it('중간 빈 행(연속 개행)은 보존, 후행 하나만 흡수', () => {
    expect(parseTsv('a\n\nb')).toEqual([['a'], [''], ['b']])
    expect(parseTsv('a\tb\n\n')).toEqual([['a', 'b'], ['']]) // 후행 1개만 흡수 → 빈 행 1개 남음
  })
  it('중간 연속 탭은 빈 셀로 보존', () => {
    expect(parseTsv('a\t\tb')).toEqual([['a', '', 'b']])
  })
  it('인용 필드 — 내부 탭/개행은 셀 내용, "" 는 리터럴 따옴표', () => {
    expect(parseTsv('"a\tb"\tc')).toEqual([['a\tb', 'c']])
    expect(parseTsv('"줄1\n줄2"')).toEqual([['줄1\n줄2']])
    expect(parseTsv('"그는 ""확인""함"')).toEqual([['그는 "확인"함']])
  })
  it('인용 안의 \\r\\n은 셀 내용으로 보존(행 구분 아님)', () => {
    expect(parseTsv('"줄1\r\n줄2"\tx')).toEqual([['줄1\r\n줄2', 'x']])
  })
  it('빈 입력 → 단일 빈 셀', () => {
    expect(parseTsv('')).toEqual([['']])
  })
  it('필드 선두가 아닌 따옴표는 리터럴', () => {
    expect(parseTsv('ab"cd')).toEqual([['ab"cd']])
  })
})

describe('왕복 불변식 parseTsv(serializeTsv(x)) === x', () => {
  const cases: { name: string; grid: string[][] }[] = [
    { name: '단순', grid: [['a', 'b'], ['c', 'd']] },
    { name: '멀티라인 셀', grid: [['실적 A\n둘째 줄', '이슈 A'], ['실적 B', '']] },
    { name: '따옴표·탭 섞임', grid: [['그는 "확인"함', 'a\tb'], ['c\rd', '평범']] },
    { name: '빈 셀 포함', grid: [['', 'x', ''], ['y', '', 'z']] },
    { name: '따옴표만', grid: [['"']] },
    { name: '개행만', grid: [['\n']] },
  ]
  for (const { name, grid } of cases) {
    it(name, () => expect(parseTsv(serializeTsv(grid))).toEqual(grid))
  }
})

describe('외부 도구 상호 호환', () => {
  it('구글시트 형태(멀티라인 셀 인용 + 후행 개행) 붙여넣기 파싱', () => {
    // 구글시트에서 2×2 복사: 좌상단 셀이 멀티라인, 마지막에 개행
    const clip = '"실적 A\n둘째 줄"\t이슈 A\n실적 B\t이슈 B\n'
    expect(parseTsv(clip)).toEqual([
      ['실적 A\n둘째 줄', '이슈 A'],
      ['실적 B', '이슈 B'],
    ])
  })
  it('엑셀 형태(CRLF 행·인용 셀) 파싱', () => {
    const clip = 'a\t"b,c"\r\n"d\te"\tf\r\n'
    expect(parseTsv(clip)).toEqual([
      ['a', 'b,c'],
      ['d\te', 'f'],
    ])
  })
  it('이 시트에서 복사한 값이 외부에 그대로 붙는 형태(직렬화 결과)', () => {
    expect(serializeTsv([['한 줄', '두\n줄'], ['탭\t포함', '"인용"']]))
      .toBe('한 줄\t"두\n줄"\n"탭\t포함"\t"""인용"""')
  })
})

describe('적대적 경계 케이스', () => {
  it('미닫힘 따옴표 — EOF까지 셀 내용으로 흡수(graceful)', () => {
    expect(parseTsv('"abc')).toEqual([['abc']])
    expect(parseTsv('a\t"bc')).toEqual([['a', 'bc']])
  })
  it('탭만 있는 행 → 빈 셀 2개', () => {
    expect(parseTsv('\t')).toEqual([['', '']])
  })
  it('\\n·\\r\\n·\\r 혼합 줄바꿈을 모두 행 경계로', () => {
    expect(parseTsv('a\nb\r\nc\rd')).toEqual([['a'], ['b'], ['c'], ['d']])
  })
  it('빈 인용 셀("") — 후행 개행 흡수와 구별되는 명시적 빈 셀', () => {
    expect(parseTsv('""')).toEqual([['']])
    expect(parseTsv('a\t""\tb')).toEqual([['a', '', 'b']])
  })
  it('단일 열 마지막 빈 행은 후행 개행 규칙상 왕복 비대칭(§3.1 수용 — 다열은 정상)', () => {
    expect(serializeTsv([['a'], ['']])).toBe('a\n')
    expect(parseTsv('a\n')).toEqual([['a']]) // 마지막 단일 빈 셀은 후행 개행으로 흡수됨(의도)
    // 다열 마지막 행은 유실 없음
    expect(parseTsv(serializeTsv([['a', 'b'], ['', '']]))).toEqual([['a', 'b'], ['', '']])
  })
})
