// 레인 요약(summary) 검증·읽기·경과 표기·행 조립 — 계약 lane-summary-contract.md v:1.
import { describe, expect, it } from 'vitest'
import {
  agoText, assembleLaneSummaryRows, parseLaneSummary, readLaneSummary, toWire, LANE_SUMMARY_MAX_BYTES,
  clockText, durationText, inputKindLabel, inputWaitView, INPUT_OVERDUE_MS,
} from '@/lib/domain/laneSummary'

const good = {
  v: 1, lane: 'office-tally', state: 'active', brief: '레인 요약 행', items_done: 2, items_total: 5, hold: null,
  branch: 'feat/lane-summary', last_report_at: '2026-10-06T13:51:36+09:00', last_instr_at: '2026-10-06T13:13:08+09:00', ctx_pct: null, compact_pending: false,
}
const NOW = Date.parse('2026-10-06T14:00:00+09:00')

describe('parseLaneSummary', () => {
  it('없으면 ok 와 null — 라벨만 보내는 옛 PC', () => {
    expect(parseLaneSummary(undefined)).toEqual({ ok: true, value: null })
    expect(parseLaneSummary(null)).toEqual({ ok: true, value: null })
  })
  it('계약 필드를 읽어 정규화한다', () => {
    const r = parseLaneSummary(good)
    expect(r).toMatchObject({ ok: true, value: { v: 1, lane: 'office-tally', state: 'active', itemsDone: 2, itemsTotal: 5, hold: null, ctxPct: null, compactPending: false } })
  })
  it('모르는 키(경로·핸들·pid)는 버리고 저장 모양에도 싣지 않는다', () => {
    const r = parseLaneSummary({ ...good, handle: 'term_x', pid: 9425, worktree: '/Users/jji/x', session: { id: 's' } })
    expect(r.ok).toBe(true)
    if (r.ok && r.value) {
      const wire = JSON.stringify(toWire(r.value))
      for (const k of ['handle', 'pid', 'worktree', 'session', 'term_x', '/Users/jji']) expect(wire).not.toContain(k)
    }
  })
  it('v 가 1 이 아니거나 객체가 아니면 error', () => {
    expect(parseLaneSummary({ ...good, v: 2 }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, v: undefined }).ok).toBe(false)
    expect(parseLaneSummary('x').ok).toBe(false)
    expect(parseLaneSummary([good]).ok).toBe(false)
  })
  it('lane·state 는 필수, 문자열 상한은 코드포인트로 잰다', () => {
    expect(parseLaneSummary({ ...good, lane: '' }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, state: undefined }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, brief: '가'.repeat(200) }).ok).toBe(true)
    expect(parseLaneSummary({ ...good, brief: '가'.repeat(201) }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, hold: '😀'.repeat(100) }).ok).toBe(true) // 이모지는 UTF-16 으로 2 이지만 코드포인트 1
    expect(parseLaneSummary({ ...good, hold: '😀'.repeat(101) }).ok).toBe(false)
  })
  it('숫자·시각·불리언 형식', () => {
    expect(parseLaneSummary({ ...good, items_done: -1 }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, items_total: 1.5 }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, ctx_pct: 101 }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, ctx_pct: 42 })).toMatchObject({ ok: true, value: { ctxPct: 42 } })
    expect(parseLaneSummary({ ...good, last_report_at: '어제' }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, compact_pending: 'yes' }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, compact_pending: true })).toMatchObject({ ok: true, value: { compactPending: true } })
  })
  it('전체 2KB(UTF-8 바이트) 상한 — 한글은 글자당 3바이트', () => {
    // 개별 상한을 다 채우면 brief 600 + hold 300 + branch 360 바이트 정도라 2KB 안이다 — 상한이 실제로 걸리는 값은 따로 만든다.
    const r = parseLaneSummary({ ...good, brief: '가'.repeat(200), hold: '나'.repeat(100), branch: '다'.repeat(120), lane: '라'.repeat(60) })
    expect(r.ok).toBe(true)
    expect(LANE_SUMMARY_MAX_BYTES).toBe(2048)
  })
  it('readLaneSummary — 저장된 값이 깨졌으면 null(표시를 막지 않는다)', () => {
    expect(readLaneSummary(good)).toMatchObject({ lane: 'office-tally', itemsTotal: 5 })
    expect(readLaneSummary({ junk: true })).toBeNull()
    expect(readLaneSummary(null)).toBeNull()
  })
})

describe('agoText', () => {
  it('방금·분·시간·일, 시각이 없거나 깨지면 null, 미래는 방금', () => {
    expect(agoText('2026-10-06T13:59:40+09:00', NOW)).toBe('방금')
    expect(agoText('2026-10-06T13:51:36+09:00', NOW)).toBe('8분 전')
    expect(agoText('2026-10-06T11:00:00+09:00', NOW)).toBe('3시간 전')
    expect(agoText('2026-10-03T14:00:00+09:00', NOW)).toBe('3일 전')
    expect(agoText('2026-10-06T15:00:00+09:00', NOW)).toBe('방금')
    expect(agoText(null, NOW)).toBeNull()
    expect(agoText('x', NOW)).toBeNull()
  })
})

const sum = (over: object = {}) => { const r = parseLaneSummary({ ...good, ...over }); return r.ok ? r.value : null }
const w = (agent: string, over: object = {}) => ({ agent, untilLabel: '작업 중', lastSeenAt: '2026-10-06T13:00:00Z', ...over })

describe('assembleLaneSummaryRows', () => {
  it('임시 팀원만 행이 되고 일반 감시자·조정 팀장은 뺀다', () => {
    const rows = assembleLaneSummaryRows([{ watchers: [w('jji/mac/lead'), w('jji/mac/coord:r1'), w('jji/mac/poll'), w('jji/mac/임시:eng·엔진')] }], NOW)
    expect(rows.map(r => r.agent)).toEqual(['jji/mac/임시:eng·엔진'])
  })
  it('층마다 겹쳐 실린 같은 감시자는 최근 신호 한 건으로 센다', () => {
    const a = w('jji/mac/임시:eng·x', { summary: sum({ lane: 'eng', brief: '옛' }), lastSeenAt: '2026-10-06T12:00:00Z' })
    const b = w('jji/mac/임시:eng·x', { summary: sum({ lane: 'eng', brief: '새' }), lastSeenAt: '2026-10-06T13:00:00Z' })
    const rows = assembleLaneSummaryRows([{ watchers: [a] }, { watchers: [b] }], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].summary?.brief).toBe('새')
  })
  it('요약이 없으면 summary null 이고 상태는 until 라벨, 레인은 슬롯의 레인이다(「요약 없음」은 화면이 쓴다)', () => {
    const [r] = assembleLaneSummaryRows([{ watchers: [w('jji/mac/임시:srv·서버', { untilLabel: '머지 중' })] }], NOW)
    expect(r).toMatchObject({ lane: 'srv', state: '머지 중', summary: null, reportAgo: null, instrAgo: null, items: null })
  })
  it('요약이 있으면 레인·상태·경과·진행을 채운다', () => {
    const [r] = assembleLaneSummaryRows([{ watchers: [w('jji/mac/임시:office-tally·요약', { summary: sum() })] }], NOW)
    expect(r).toMatchObject({ lane: 'office-tally', state: 'active', reportAgo: '8분 전', instrAgo: '46분 전', items: '2/5' })
  })
  it('레인 이름순(숫자는 수로)', () => {
    const rows = assembleLaneSummaryRows([{ watchers: [w('jji/mac/임시:l10·a'), w('jji/mac/임시:l2·b'), w('jji/mac/임시:a·c')] }], NOW)
    expect(rows.map(r => r.lane)).toEqual(['a', 'l2', 'l10'])
  })
  it('감시자가 없으면 빈 배열', () => {
    expect(assembleLaneSummaryRows([], NOW)).toEqual([])
    expect(assembleLaneSummaryRows([{ watchers: [] }], NOW)).toEqual([])
  })
})

describe('assembleLaneSummaryRows — 좌석 키·입력 요청', () => {
  const req = { v: 1 as const, kind: 'permission' as const, since: '2026-10-06T13:50:00Z', handled: null }
  it('행마다 감시자의 agent 를 seatKey 로, 입력 요청 메타를 그대로 싣는다', () => {
    const [r] = assembleLaneSummaryRows([{ watchers: [w('jji/mac/임시:eng·엔진', { inputRequest: req })] }], NOW)
    expect(r.seatKey).toBe('jji/mac/임시:eng·엔진')
    expect(r.seatKey).toBe(r.agent)
    expect(r.inputRequest).toEqual(req)
  })
  it('입력 요청이 없거나 칸이 없는 옛 감시자는 null', () => {
    const rows = assembleLaneSummaryRows([{ watchers: [w('jji/mac/임시:a·x', { inputRequest: null }), w('jji/mac/임시:b·y')] }], NOW)
    expect(rows.map(r => r.inputRequest)).toEqual([null, null])
  })
  it('겹쳐 실린 감시자는 최근 신호 쪽의 입력 요청을 쓴다', () => {
    const a = w('jji/mac/임시:eng·x', { inputRequest: req, lastSeenAt: '2026-10-06T12:00:00Z' })
    const b = w('jji/mac/임시:eng·x', { inputRequest: { ...req, handled: { by: 'auto' as const, at: '2026-10-06T13:55:00Z' } }, lastSeenAt: '2026-10-06T13:00:00Z' })
    const [r] = assembleLaneSummaryRows([{ watchers: [a] }, { watchers: [b] }], NOW)
    expect(r.inputRequest?.handled?.by).toBe('auto')
  })
})

describe('입력 대기 배지 규칙', () => {
  const SINCE = '2026-10-06T14:00:00+09:00'
  const sinceMs = Date.parse(SINCE)
  const meta = { kind: 'permission', since: SINCE, handled: null }
  it('종류 라벨 — 모르는 종류는 원문 그대로', () => {
    expect(['permission', 'question', 'choice', 'usage-limit', 'trust', 'message'].map(inputKindLabel))
      .toEqual(['권한 요청', '질문', '선택', '사용량 한도', '신뢰 확인', '메시지 질문'])
    expect(inputKindLabel('weird')).toBe('weird')
    expect(inputKindLabel('toString')).toBe('toString')
  })
  it('대기 시간은 since 기준이고 정확히 5분은 경고가 아니다(5분 1초부터)', () => {
    expect(INPUT_OVERDUE_MS).toBe(300_000)
    const at = (ms: number) => inputWaitView(meta, sinceMs + ms)
    expect(at(0)).toMatchObject({ state: 'waiting', waitMs: 0, waitText: '1분 미만', overdue: false })
    expect(at(4 * 60_000 + 59_000)).toMatchObject({ waitText: '4분', overdue: false })
    expect(at(5 * 60_000)).toMatchObject({ waitText: '5분', overdue: false })
    expect(at(5 * 60_000 + 1_000)).toMatchObject({ waitText: '5분', overdue: true })
    expect(at(75 * 60_000)).toMatchObject({ waitText: '1시간 15분', overdue: true })
  })
  it('시계가 어긋나 since 가 미래여도 음수 대기를 만들지 않는다', () => {
    expect(inputWaitView(meta, sinceMs - 90_000)).toMatchObject({ waitMs: 0, overdue: false })
  })
  it('since 를 읽을 수 없으면 대기 시간 「—」 이고 경고하지 않는다', () => {
    expect(inputWaitView({ ...meta, since: '어제' }, NOW)).toMatchObject({ state: 'waiting', waitMs: null, waitText: '—', overdue: false })
  })
  it('처리된 건은 「처리됨 (조정자|자동) 시각」 이고 대기 시간·경고가 없다', () => {
    const h = (by: 'coordinator' | 'auto') => inputWaitView({ ...meta, handled: { by, at: '2026-10-06T09:03:00Z' } }, sinceMs + 3_600_000)
    expect(h('coordinator')).toMatchObject({ state: 'handled', byLabel: '조정자', atText: '18:03', text: '처리됨 (조정자) 18:03' })
    expect(h('auto')).toMatchObject({ state: 'handled', text: '처리됨 (자동) 18:03' })
    expect(h('auto')).not.toHaveProperty('overdue')
  })
  it('durationText·clockText', () => {
    expect(durationText(-5)).toBe('1분 미만')
    expect(durationText(60 * 60_000)).toBe('1시간')
    expect(durationText(26 * 3_600_000)).toBe('1일 2시간')
    expect(durationText(48 * 3_600_000)).toBe('2일')
    expect(clockText('2026-10-06T15:05:00Z')).toBe('00:05')
    expect(clockText('x')).toBeNull()
    expect(clockText(null)).toBeNull()
  })
})

describe('리뷰 반영 — 유니코드·시각·진행 경계', () => {
  it('NUL 과 제어 문자는 지우고, 짝 없는 서로게이트는 그 칸을 거절한다(jsonb 22P05 방지)', () => {
    const r = parseLaneSummary({ ...good, brief: 'a\u0000b\u001b[31mc\nd' })
    expect(r).toMatchObject({ ok: true, value: { brief: 'ab[31mc d' } })
    expect(parseLaneSummary({ ...good, brief: 'x\ud800y' }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, brief: 'x\udc00' }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, brief: '😀' }).ok).toBe(true)
  })
  it('시각은 시간대가 있는 ISO 만 받는다 — 시간대 없음·숫자·자연어는 거절', () => {
    for (const bad of ['1', '2026', '2026-10-06T10:00:00', 'March 7, 2026 10:00', '2026-10-06']) {
      expect(parseLaneSummary({ ...good, last_report_at: bad }).ok, bad).toBe(false)
    }
    for (const okv of ['2026-10-06T10:00:00Z', '2026-10-06T10:00:00.123+09:00', '2026-10-06T10:00:00-05:00']) {
      expect(parseLaneSummary({ ...good, last_report_at: okv }).ok, okv).toBe(true)
    }
  })
  it('완료 수가 전체를 넘으면 전체로 자른다(9/3 으로 보이지 않는다)', () => {
    expect(parseLaneSummary({ ...good, items_done: 9, items_total: 3 })).toMatchObject({ ok: true, value: { itemsDone: 3, itemsTotal: 3 } })
  })
})

describe('parseLaneSummary — lead 칸(이 레인을 거느린 조정 팀장의 세션 식별자, 2026-10-06 계약)', () => {
  it('lead 를 읽어 저장 모양에도 싣는다', () => {
    const r = parseLaneSummary({ ...good, lead: '0f8a8f92' })
    expect(r).toMatchObject({ ok: true, value: { lead: '0f8a8f92' } })
    if (r.ok && r.value) expect(toWire(r.value)).toMatchObject({ lead: '0f8a8f92' })
  })
  it('없거나 null·빈 문자열이면 null — 칸을 안 보내는 옛 PC 는 그대로 읽힌다', () => {
    for (const v of [undefined, null, '', '  ']) {
      expect(parseLaneSummary({ ...good, lead: v })).toMatchObject({ ok: true, value: { lead: null } })
    }
    expect(parseLaneSummary(good)).toMatchObject({ ok: true, value: { lead: null } })
  })
  it('40자를 넘거나 문자열이 아니면 error — 요약 전체가 null 이 되고 그 레인은 팀장 미확인이다', () => {
    expect(parseLaneSummary({ ...good, lead: 'x'.repeat(41) }).ok).toBe(false)
    expect(parseLaneSummary({ ...good, lead: 'x'.repeat(40) }).ok).toBe(true)
    expect(parseLaneSummary({ ...good, lead: 12 }).ok).toBe(false)
  })
  it('제어 문자는 지운다', () => {
    expect(parseLaneSummary({ ...good, lead: 'ab\u0000cd' })).toMatchObject({ ok: true, value: { lead: 'abcd' } })
  })
})
