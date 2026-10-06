// tests/domain/agent-console.test.ts — 콘솔 대상 해석·ack·화면 항목 규칙(계약 §2.12).
import { describe, expect, it } from 'vitest'
import { consoleAckIssue, consoleTargetOfAgent, parseConsoleScreenItem } from '@/lib/domain/agentConsole'

describe('consoleTargetOfAgent', () => {
  it('네 종류를 읽는다 — lead · w<N> · coord:<세션8> · 임시:<레인>·<요약>', () => {
    expect(consoleTargetOfAgent('hong/mbp/lead')).toEqual({ kind: 'team_lead', ref: 'lead', host: 'mbp' })
    expect(consoleTargetOfAgent('hong/mbp/w12')).toEqual({ kind: 'team_worker', ref: 'w12', host: 'mbp' })
    expect(consoleTargetOfAgent('hong/mbp/coord:0f8a8f92')).toEqual({ kind: 'coord_lead', ref: '0f8a8f92', host: 'mbp' })
    expect(consoleTargetOfAgent('hong/mbp/임시:kit·노드 · 엔진')).toEqual({ kind: 'coord_lane', ref: 'kit', host: 'mbp' })
    expect(consoleTargetOfAgent('hong/mbp/임시:web')).toEqual({ kind: 'coord_lane', ref: 'web', host: 'mbp' })
  })
  it('대상이 아니거나 형식이 계약 밖이면 null', () => {
    for (const k of ['hong/mbp/poll', 'hong/mbp/coord', 'hong/mbp/coord:', 'hong/mbp/coordinator', 'hong/MBP/lead',
      'hong/mbp/임시:레인A·x', 'claude-mbp', 'pat-1234abcd', 'a/b', 'a/b/c/d', '', null, undefined, 'hong/mbp/w', 'hong/mbp/w1x']) {
      expect(consoleTargetOfAgent(k)).toBeNull()
    }
  })
})

describe('consoleAckIssue', () => {
  it('계약 규칙 — sent(detail 선택), refused·retry 는 사유 필수, retry 는 compacting 만', () => {
    expect(consoleAckIssue({ result: 'sent' })).toBeNull()
    expect(consoleAckIssue({ result: 'sent', detail: 'accepted' })).toBeNull()
    expect(consoleAckIssue({ result: 'refused', reason: 'draft-in-input' })).toBeNull()
    expect(consoleAckIssue({ result: 'retry', reason: 'compacting' })).toBeNull()
    expect(consoleAckIssue({ result: 'refused' })).not.toBeNull()
    expect(consoleAckIssue({ result: 'retry', reason: 'not-idle' })).not.toBeNull()
    expect(consoleAckIssue({ result: 'sent', detail: 'typed' })).not.toBeNull()
    expect(consoleAckIssue({ result: 'refused', reason: 'error', detail: 'accepted' })).not.toBeNull()
    expect(consoleAckIssue({ result: 'ok' })).not.toBeNull()
  })
})

describe('parseConsoleScreenItem', () => {
  const NOW = Date.parse('2026-10-06T09:00:30Z')
  const base = { target_kind: 'team_lead', target_ref: 'lead', sha: 'f'.repeat(64), captured_at: '2026-10-06T09:00:00Z' }
  const parse = (o: unknown) => parseConsoleScreenItem(o, NOW)
  it('lines 가 없으면 touch, 있으면 저장 — captured_at 은 ISO 로 고친다, 탭은 허용', () => {
    expect(parse(base)).toEqual({ item: { kind: 'team_lead', ref: 'lead', sha: 'f'.repeat(64), capturedAt: '2026-10-06T09:00:00.000Z', lines: null } })
    const r = parse({ ...base, lines: ['a\tb', ''] })
    expect('item' in r && r.item.lines).toEqual(['a\tb', ''])
  })
  it('8KB 는 줄 바이트의 합(개행 제외, DB·§4.1 과 같다) — 경계 안은 통과, 하나 넘으면 too_large', () => {
    const ok = [...Array(20).fill('x'.repeat(400)), 'x'.repeat(192)] // 8192
    expect('item' in parse({ ...base, lines: ok })).toBe(true)
    const over = [...Array(20).fill('x'.repeat(400)), 'x'.repeat(193)] // 8193
    expect(parse({ ...base, lines: over })).toMatchObject({ reason: 'too_large' })
  })
  it('한 줄 400자는 코드포인트로 센다 — 이모지 400개는 통과, 401개는 line_too_long', () => {
    expect('item' in parse({ ...base, lines: ['😀'.repeat(400)] })).toBe(true)
    expect(parse({ ...base, lines: ['😀'.repeat(401)] })).toMatchObject({ reason: 'line_too_long' })
  })
  it('captured_at 은 ISO 8601 만, 서버보다 5분 넘게 미래면 거절', () => {
    for (const bad of ['nope', '1', '2026-10-06', '2026-10-06 09:00:00', '2026-10-06T09:06:00Z']) {
      expect(parse({ ...base, captured_at: bad })).toMatchObject({ reason: 'invalid_captured_at' })
    }
    expect('item' in parse({ ...base, captured_at: '2026-10-06T18:04:00+09:00' })).toBe(true)
  })
  it('잘못된 항목은 사유와 함께 대상을 되돌려 준다', () => {
    expect(parse({ ...base, target_kind: 'boss' })).toEqual({ reason: 'invalid_target', kind: 'boss', ref: 'lead' })
    expect(parse({ ...base, lines: 'oops' })).toMatchObject({ reason: 'invalid_lines' })
    expect(parse({ ...base, lines: Array(41).fill('x') })).toMatchObject({ reason: 'too_many_lines' })
    expect(parse({ ...base, lines: ['a', 3] })).toMatchObject({ reason: 'invalid_line' })
    expect(parse({ ...base, lines: ['\u0085'] })).toMatchObject({ reason: 'control_char' })
    expect(parse(null)).toEqual({ reason: 'invalid_item' })
  })
})
