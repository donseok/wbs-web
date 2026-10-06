// tests/domain/agent-console.test.ts — 콘솔 대상 해석·ack·화면 항목 규칙(계약 §2.12).
import { describe, expect, it } from 'vitest'
import { isAuxWatcherAgent } from '@/lib/domain/agentRoster'
import { CONSOLE_KEYS, CONSOLE_KEYS_MAX, consoleAckIssue, consolePatMaySeatKey, isAuxConsoleSeat, CONSOLE_AUX_KINDS, consoleKeysLabel, consoleTargetOfAgent, parseConsoleKeys, parseConsoleScreenItem } from '@/lib/domain/agentConsole'

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

describe('consoleAckIssue — prompt_changed(키 입력 재판정 거절)', () => {
  it('refused 와는 쓸 수 있고, sent·retry 와는 쓸 수 없다', () => {
    expect(consoleAckIssue({ result: 'refused', reason: 'prompt_changed' })).toBeNull()
    expect(consoleAckIssue({ result: 'sent', reason: 'prompt_changed' })).not.toBeNull()
    expect(consoleAckIssue({ result: 'retry', reason: 'prompt_changed' })).not.toBeNull()
  })
})

describe('parseConsoleKeys — 허용 키만 1~4개', () => {
  it('허용 키 열네 개를 모두 받고 복사본을 돌려준다', () => {
    expect([...CONSOLE_KEYS]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Esc', 'Up', 'Down', 'Tab'])
    for (const k of CONSOLE_KEYS) expect(parseConsoleKeys([k])).toEqual([k])
    const src = ['Down', 'Enter']
    const out = parseConsoleKeys(src)
    expect(out).toEqual(['Down', 'Enter'])
    expect(out).not.toBe(src)
    expect(parseConsoleKeys(['Down', 'Down', 'Down', 'Enter'])).toHaveLength(CONSOLE_KEYS_MAX)
  })
  it('목록 밖·대소문자 변형·공백·객체·중첩·빈 배열·상한 초과는 null', () => {
    const bad: unknown[] = [
      undefined, null, 'Enter', {}, [], ['0'], ['10'], ['enter'], ['ENTER'], ['Enter '], [' 1'], ['esc'], ['up'], ['Left'], ['F5'], ['ctrl+c'], ['C-c'],
      ['\n'], ['1\n'], [1], [null], [undefined], [['1']], [{ toString: () => '1' }], ['1', 'x'], ['1', '2', '3', '4', '5'],
      [, '1'],
    ]
    for (const b of bad) expect(parseConsoleKeys(b), JSON.stringify(b)).toBeNull()
  })
  it('순서 규칙 — 확정 키(1~9·Enter·Esc)와 Tab 은 마지막에 하나만, 앞은 Up·Down 뿐(재판정은 첫 키만 보호하고 Tab 은 화면을 바꾼다)', () => {
    const ok: string[][] = [
      ['1'], ['9'], ['Enter'], ['Esc'], ['Up'], ['Down'], ['Tab'],
      ['Up', 'Tab'], ['Up', 'Up', 'Up', 'Up'], ['Down', 'Enter'], ['Up', 'Down', 'Up', 'Esc'], ['Down', 'Down', 'Down', '3'], ['Down', 'Down', 'Up', 'Tab'],
    ]
    for (const k of ok) expect(parseConsoleKeys(k), k.join(' ')).toEqual(k)
    const bad: string[][] = [
      ['1', 'Enter'], ['Enter', 'Enter'], ['Esc', 'Esc'], ['1', '2'], ['Enter', 'Up'], ['Esc', 'Tab'], ['1', 'Up'],
      ['Tab', 'Enter'], ['Tab', '1'], ['Tab', 'Tab'], ['Tab', 'Up'], ['Up', 'Tab', 'Enter'], ['Up', 'Tab', 'Down'],
      ['Up', 'Enter', 'Tab'], ['Up', 'Enter', 'Enter'], ['Enter', 'Up', 'Up', 'Up'], ['9', 'Down', 'Down', 'Enter'],
    ]
    for (const k of bad) expect(parseConsoleKeys(k), k.join(' ')).toBeNull()
  })
  it('전달 상태 표의 표기', () => {
    expect(consoleKeysLabel(['Down', 'Enter'])).toBe('키: Down Enter')
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

describe('프로젝트 한정 PAT 의 보조 좌석 판정(consolePatMaySeatKey)', () => {
  it('한정 없는 PAT 는 모든 열쇠를 쓴다', () => {
    expect(consolePatMaySeatKey(null, 'team_worker', ['p2'])).toBe(true)
    expect(consolePatMaySeatKey(null, 'coord_lane', [null])).toBe(true)
  })
  it('한정 PAT — 자기 프로젝트 좌석만이거나, 프로젝트 없는 조정 세션 칸만일 때 허용', () => {
    expect(consolePatMaySeatKey('p1', 'team_worker', ['p1', 'p1'])).toBe(true)
    expect(consolePatMaySeatKey('p1', 'coord_lane', [null])).toBe(true)
    expect(consolePatMaySeatKey('p1', 'coord_lead', [null, null])).toBe(true)
  })
  it('한정 PAT — 프로젝트 없는 team 좌석·남의 프로젝트 좌석·섞인 열쇠는 거절', () => {
    expect(consolePatMaySeatKey('p1', 'team_lead', [null])).toBe(false)
    expect(consolePatMaySeatKey('p1', 'team_worker', ['p2'])).toBe(false)
    expect(consolePatMaySeatKey('p1', 'team_worker', ['p1', 'p2'])).toBe(false)
    expect(consolePatMaySeatKey('p1', 'coord_lane', [null, 'p9'])).toBe(false)
    expect(consolePatMaySeatKey('p1', 'coord_lane', ['p9'])).toBe(false)
    expect(consolePatMaySeatKey('p1', 'coord_lane', [])).toBe(false)
  })
  it('isAuxConsoleSeat — 조정 세션 칸이면서 프로젝트가 없을 때만', () => {
    expect(isAuxConsoleSeat({ kind: 'coord_lane', projectId: null })).toBe(true)
    expect(isAuxConsoleSeat({ kind: 'coord_lead', projectId: null })).toBe(true)
    expect(isAuxConsoleSeat({ kind: 'coord_lane', projectId: 'p1' })).toBe(false)
    expect(isAuxConsoleSeat({ kind: 'team_lead', projectId: null })).toBe(false)
  })
})

describe('보조 좌석 불변식 — coord_* 로 읽히는 agent 는 감시자 project_id 가 늘 null 인 보조 슬롯이다', () => {
  it('consoleTargetOfAgent 가 coord_lead·coord_lane 으로 읽으면 isAuxWatcherAgent 도 true, 그 밖은 false', () => {
    for (const a of ['hong/mbp/coord:0f8a8f92', 'hong/mbp/임시:kit·노드 엔진', 'hong/mbp/임시:web']) {
      expect(CONSOLE_AUX_KINDS.includes(consoleTargetOfAgent(a)!.kind)).toBe(true)
      expect(isAuxWatcherAgent(a)).toBe(true)
    }
    for (const a of ['hong/mbp/lead', 'hong/mbp/w3']) {
      expect(CONSOLE_AUX_KINDS.includes(consoleTargetOfAgent(a)!.kind)).toBe(false)
      expect(isAuxWatcherAgent(a)).toBe(false)
    }
  })
})
