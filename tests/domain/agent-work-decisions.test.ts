// 결정 목록 검증·파서(과제 C, 스펙 §3.3·§7). 서버 400 사유와 화면 상태가 여기서 정해진다.
import { describe, expect, it } from 'vitest'
import {
  AGENT_DECISIONS_MAX, AGENT_DECISION_QUESTION_MAX, parseDecisions, validateDecisions,
} from '@/lib/domain/agentWork'

const item = (over: Record<string, unknown> = {}) => ({
  key: 'D1', question: '판정 로직을 넣는가?', options: ['넣지 않는다', '넣는다'], chosen: 0,
  rationale: 'spec 이 넣지 않는다고 적었다.', on_reject: '판정 로직을 옮긴다.', ...over,
})
const err = (raw: unknown) => {
  const r = validateDecisions(raw)
  if (r.ok) throw new Error('통과하면 안 된다')
  return r.error
}

describe('validateDecisions — 모양', () => {
  it('필드가 없으면(undefined) 제출 안 됨 = null', () => {
    expect(validateDecisions(undefined)).toEqual({ ok: true, decisions: null })
  })
  it('[] 는 0건 명시로 통과한다', () => {
    expect(validateDecisions([])).toEqual({ ok: true, decisions: [] })
  })
  it('명시적 null·객체·문자열은 배열이 아니라 400', () => {
    expect(err(null)).toBe('decisions는 배열이어야 합니다.')
    expect(err({})).toBe('decisions는 배열이어야 합니다.')
    expect(err('D1')).toBe('decisions는 배열이어야 합니다.')
  })
  it('20건은 통과, 21건은 400', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item({ key: `D${i + 1}` }))
    expect(validateDecisions(many(AGENT_DECISIONS_MAX)).ok).toBe(true)
    expect(err(many(21))).toBe('decisions는 20건 이하여야 합니다.')
  })
  it('원소가 객체가 아니면 경로를 담은 400', () => {
    expect(err([item(), 'x'])).toBe('decisions[1]는 객체여야 합니다.')
    expect(err([[1]])).toBe('decisions[0]는 객체여야 합니다.')
  })
  it('알 수 없는 필드는 400(evidence 와 같은 규칙)', () => {
    expect(err([item({ note: 'x' })])).toBe('decisions[0]에 알 수 없는 필드: note')
  })
})

describe('validateDecisions — key', () => {
  it.each(['D1', 'D9', 'D10', 'D99'])('%s 는 통과', k => {
    expect(validateDecisions([item({ key: k })]).ok).toBe(true)
  })
  it.each(['D0', 'D100', 'd1', ' D1', '1', 'D01', 7])('%s 는 400', k => {
    expect(err([item({ key: k })])).toBe('decisions[0].key는 D1~D99 형식이어야 합니다.')
  })
  it('보고 안에서 중복되면 400', () => {
    expect(err([item(), item()])).toBe('decisions[1].key가 중복됩니다: D1')
  })
})

describe('validateDecisions — 글자 수·trim(코드포인트)', () => {
  it('한글 300자 question 은 통과, 301자는 400', () => {
    expect(validateDecisions([item({ question: '가'.repeat(AGENT_DECISION_QUESTION_MAX) })]).ok).toBe(true)
    expect(err([item({ question: '가'.repeat(301) })])).toBe('decisions[0].question은 1~300자여야 합니다.')
  })
  it('서로게이트 쌍(이모지)은 한 글자로 센다 — jq length 와 같은 축', () => {
    expect(validateDecisions([item({ question: '😀'.repeat(300) })]).ok).toBe(true)
  })
  it('공백만 있는 문자열은 trim 뒤 0자라 400', () => {
    expect(err([item({ question: '   ' })])).toBe('decisions[0].question은 1~300자여야 합니다.')
    expect(err([item({ rationale: '\n\t ' })])).toBe('decisions[0].rationale은 1~1000자여야 합니다.')
    expect(err([item({ on_reject: ' ' })])).toBe('decisions[0].on_reject는 1~500자여야 합니다.')
    expect(err([item({ options: ['a', ' '] })])).toBe('decisions[0].options[1]는 1~200자여야 합니다.')
  })
  it('rationale 1000·on_reject 500·option 200 경계', () => {
    expect(validateDecisions([item({ rationale: 'r'.repeat(1000), on_reject: 'o'.repeat(500), options: ['a'.repeat(200), 'b'] })]).ok).toBe(true)
    expect(err([item({ rationale: 'r'.repeat(1001) })])).toBe('decisions[0].rationale은 1~1000자여야 합니다.')
    expect(err([item({ on_reject: 'o'.repeat(501) })])).toBe('decisions[0].on_reject는 1~500자여야 합니다.')
    expect(err([item({ options: ['a'.repeat(201), 'b'] })])).toBe('decisions[0].options[0]는 1~200자여야 합니다.')
  })
  it('저장 값은 trim 된 문자열이다', () => {
    const r = validateDecisions([item({ question: '  질문  ', options: [' 가 ', '나 '], rationale: ' 근거 ', on_reject: ' 방향 ' })])
    expect(r).toEqual({ ok: true, decisions: [{ key: 'D1', question: '질문', options: ['가', '나'], chosen: 0, rationale: '근거', on_reject: '방향' }] })
  })
})

describe('validateDecisions — options·chosen', () => {
  it('선택지 1개·7개는 400, 2개·6개는 통과', () => {
    expect(err([item({ options: ['a'] })])).toBe('decisions[0].options는 2~6개여야 합니다.')
    expect(err([item({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })])).toBe('decisions[0].options는 2~6개여야 합니다.')
    expect(validateDecisions([item({ options: ['a', 'b', 'c', 'd', 'e', 'f'], chosen: 5 })]).ok).toBe(true)
    expect(err([item({ options: 'a,b' })])).toBe('decisions[0].options는 2~6개여야 합니다.')
  })
  it('chosen 은 정수 색인 — 문자열·소수는 400', () => {
    expect(err([item({ chosen: '넣지 않는다' })])).toBe('decisions[0].chosen은 정수여야 합니다.')
    expect(err([item({ chosen: 0.5 })])).toBe('decisions[0].chosen은 정수여야 합니다.')
  })
  it('chosen 이 범위 밖이면 400', () => {
    expect(err([item({ chosen: 2 })])).toBe('decisions[0].chosen이 options 범위를 벗어났습니다.')
    expect(err([item({ chosen: -1 })])).toBe('decisions[0].chosen이 options 범위를 벗어났습니다.')
  })
})

describe('parseDecisions — 화면 상태', () => {
  it('null·undefined 는 none(제출 안 됨)', () => {
    expect(parseDecisions(null)).toEqual({ state: 'none' })
    expect(parseDecisions(undefined)).toEqual({ state: 'none' })
  })
  it('유효한 배열은 ok, [] 도 ok(0건)', () => {
    expect(parseDecisions([])).toEqual({ state: 'ok', items: [] })
    expect(parseDecisions([item()])).toMatchObject({ state: 'ok', items: [{ key: 'D1', chosen: 0 }] })
  })
  it('깨진 항목·배열 아닌 값은 invalid(0건으로 위장하지 않는다)', () => {
    expect(parseDecisions([item({ chosen: 9 })])).toEqual({ state: 'invalid' })
    expect(parseDecisions({ a: 1 })).toEqual({ state: 'invalid' })
  })
})
