// tests/components/agent-input-request.test.tsx — 레인 요약·입력 요청 배지·팀장 자리 요약·웹에서 답하기(키 입력) 화면(2026-10-06).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ConsoleViewResult, ConsoleKeysResult } from '@/app/actions/agentHub'
import type { ConsoleKey, ConsoleKeysRequest } from '@/lib/domain/agentConsole'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getView = vi.fn<(key: string) => Promise<ConsoleViewResult>>()
const sendKeys = vi.fn<(key: string, req: ConsoleKeysRequest, keys: readonly ConsoleKey[]) => Promise<ConsoleKeysResult>>()
vi.mock('@/app/actions/agentHub', () => ({
  getConsoleView: (k: string) => getView(k),
  sendConsoleKeys: (k: string, r: ConsoleKeysRequest, keys: readonly ConsoleKey[]) => sendKeys(k, r, keys),
  sendConsolePrompt: vi.fn(),
  runHubProcessOp: vi.fn(),
}))
import { AgentConsole } from '@/components/agents/AgentConsole'
import { KEYS_RULE_TEXT, canAddKey, isFinalKey, isValidKeySequence } from '@/components/agents/InputRequestPanel'
import { LaneBoard } from '@/components/agents/LaneBoard'
import { RosterBoard } from '@/components/agents/RosterBoard'
import { OfficeChatterContext } from '@/components/agents/SeatSpeech'
import { assembleRoster } from '@/lib/domain/agentRoster'
import { parseLaneSummary } from '@/lib/domain/laneSummary'
import { parseLeadSummary } from '@/lib/domain/watcherExtras'
import type { Floor, Seatmap, Watcher } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-10-06T09:00:00Z')
const SHA = 'a'.repeat(64)
const LANE_KEY = 'hong/mbp/임시:eng·엔진'
const COORD_KEY = 'hong/mbp/coord:abcd1234'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  getView.mockReset(); sendKeys.mockReset()
  getView.mockResolvedValue({ ok: true, canSend: true, sendBlockedReason: null, canView: true, prompts: [], screen: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const q = (sel: string) => host.querySelector(sel)
const qa = (sel: string) => [...host.querySelectorAll(sel)]
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click() })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const laneSummary = (over: Record<string, unknown> = {}) => {
  const r = parseLaneSummary({
    v: 1, lane: 'eng', state: 'active', brief: '엔진 요약 행 만들기', items_done: 2, items_total: 5, hold: null, branch: 'feat/engine',
    last_report_at: new Date(NOW - 8 * 60_000).toISOString(), last_instr_at: new Date(NOW - 46 * 60_000).toISOString(), ctx_pct: 61, compact_pending: false, ...over,
  })
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const watcher = (agent: string, over: Partial<Watcher> = {}): Watcher =>
  ({ agent, host: null, slots: null, busy: null, untilLabel: '작업 중', lastSeenAt: new Date(NOW - 60_000).toISOString(), projectId: null, ...over })
const floorOf = (watchers: Watcher[]): Floor => ({ id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, watchers, leads: [], zones: [] })
const mapOf = (watchers: Watcher[]) => ({ floors: [floorOf(watchers)] }) as unknown as Seatmap
const since = (ms: number) => new Date(NOW - ms).toISOString()
const meta = (ms: number, over: Record<string, unknown> = {}) => ({ v: 1 as const, kind: 'permission' as const, since: since(ms), handled: null, ...over })

const renderLane = (watchers: Watcher[]) =>
  act(() => root.render(<LaneBoard map={mapOf(watchers)} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))

describe('LaneBoard — 레인 요약 구역', () => {
  it('감시자가 하나도 없으면 구역을 그리지 않는다', () => {
    renderLane([])
    expect(q('[data-lane-summary]')).toBeNull()
    renderLane([watcher('hong/mbp/lead'), watcher(COORD_KEY)])
    expect(q('[data-lane-summary]')).toBeNull()
  })

  it('한 행에 레인·상태·brief·진행·branch·보고/지시 경과·ctx 를 담는다', () => {
    renderLane([watcher(LANE_KEY, { summary: laneSummary() })])
    const row = q('[data-lane-summary-row="eng"]')!
    expect(row.querySelector('b')?.textContent).toBe('eng')
    expect(q('[data-lane-state]')?.textContent).toBe('active')
    expect(q('[data-lane-brief]')?.textContent).toBe('엔진 요약 행 만들기')
    expect(q('[data-lane-items]')?.textContent).toBe('진행 2/5')
    expect(q('[data-lane-branch]')?.textContent).toBe('feat/engine')
    expect(q('[data-lane-report]')?.textContent).toBe('보고 8분 전')
    expect(q('[data-lane-instr]')?.textContent).toBe('지시 46분 전')
    expect(q('[data-lane-ctx]')?.textContent).toBe('ctx 61%')
    expect(q('[data-lane-hold]')).toBeNull()
    expect(q('[data-lane-compact]')).toBeNull()
    expect(q('[data-lane-summary-none]')).toBeNull()
  })

  it('hold 는 칩으로, compact 대기는 표시로 보인다', () => {
    renderLane([watcher(LANE_KEY, { summary: laneSummary({ hold: '리뷰 대기', compact_pending: true }) })])
    expect(q('[data-lane-hold]')?.textContent).toContain('리뷰 대기')
    expect(q('[data-lane-compact]')?.textContent).toBe('compact 대기')
  })

  it('요약이 없는 레인(옛 PC)도 행은 그리고 「요약 없음」 을 보인다 — 상태는 until 라벨', () => {
    renderLane([watcher('hong/mbp/임시:srv·서버', { untilLabel: '머지 중', summary: null })])
    const row = q('[data-lane-summary-row="srv"]')!
    expect(row.querySelector('[data-lane-summary-none]')?.textContent).toBe('요약 없음')
    expect(row.querySelector('[data-lane-state]')?.textContent).toBe('머지 중')
    expect(row.querySelector('[data-lane-brief]')).toBeNull()
  })

  it('요약 칸 자체가 없는 감시자(summary 필드 생략)도 깨지지 않는다', () => {
    renderLane([watcher('hong/mbp/임시:srv·서버')])
    expect(q('[data-lane-summary-none]')?.textContent).toBe('요약 없음')
  })
})

describe('입력 요청 배지', () => {
  it('입력 대기 배지는 종류 라벨과 대기 시간을 보인다', () => {
    renderLane([watcher(LANE_KEY, { summary: laneSummary(), inputRequest: meta(3 * 60_000 + 10_000, { kind: 'choice' }) })])
    const b = q('[data-input-badge]')!
    expect(b.textContent).toContain('입력 대기 · 선택')
    expect(q('[data-input-wait]')?.textContent).toBe('3분')
    expect(b.hasAttribute('data-input-overdue')).toBe(false)
  })

  it('정확히 5분은 경고가 아니고 5분 1초부터 빨간 경고(data-input-overdue)다', () => {
    renderLane([watcher(LANE_KEY, { inputRequest: meta(5 * 60_000) })])
    expect(q('[data-input-badge]')?.hasAttribute('data-input-overdue')).toBe(false)
    renderLane([watcher(LANE_KEY, { inputRequest: meta(5 * 60_000 + 1_000) })])
    expect(q('[data-input-badge]')?.getAttribute('data-input-overdue')).toBe('true')
    expect(q('[data-input-wait]')?.textContent).toBe('5분')
  })

  it('처리된 건은 「처리됨 (조정자|자동) 시각」 으로 흐리게만 보이고 눌리는 배지가 없다', () => {
    renderLane([
      watcher(LANE_KEY, { inputRequest: meta(9 * 60_000, { handled: { by: 'coordinator', at: '2026-10-06T08:58:00Z' } }) }),
      watcher('hong/mbp/임시:srv·서버', { inputRequest: meta(9 * 60_000, { handled: { by: 'auto', at: '2026-10-06T08:59:00Z' } }) }),
    ])
    expect(qa('[data-input-handled-chip]').map(e => e.textContent)).toEqual(['처리됨 (조정자) 17:58', '처리됨 (자동) 17:59'])
    expect(q('[data-input-badge]')).toBeNull()
  })

  it('배지를 누를 때만 콘솔 보기를 한 번 부르고 발췌를 보인다 — 폴링은 없다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] })
    try {
      getView.mockResolvedValueOnce({
        ok: true, canSend: true, sendBlockedReason: null, canView: true,
        inputRequest: { kind: 'permission', since: since(60_000), handled: null, excerpt: ['Allow Bash(git push)?', '1. Yes  2. No'], sha: SHA },
      })
      renderLane([watcher(LANE_KEY, { inputRequest: meta(60_000) })])
      await flush()
      expect(getView).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(120_000) })
      expect(getView).not.toHaveBeenCalled()
      await click(q('[data-input-badge]'))
      await flush()
      expect(getView).toHaveBeenCalledTimes(1)
      expect(getView).toHaveBeenCalledWith(LANE_KEY)
      expect(q('[data-input-excerpt]')?.textContent).toBe('Allow Bash(git push)?\n1. Yes  2. No')
      await act(async () => { vi.advanceTimersByTime(120_000) })
      expect(getView).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('응답에 입력 요청 칸이 없으면 「발췌를 볼 권한이 없습니다」', async () => {
    getView.mockResolvedValueOnce({ ok: true, canSend: false, sendBlockedReason: null, canView: false })
    renderLane([watcher(LANE_KEY, { inputRequest: meta(60_000) })])
    await click(q('[data-input-badge]'))
    await flush()
    expect(q('[data-input-message]')?.textContent).toBe('발췌를 볼 권한이 없습니다.')
    expect(q('[data-input-excerpt]')).toBeNull()
  })

  it('inputRequestError 가 있으면 그 문장을, 조회 실패는 실패 문장을 보인다', async () => {
    getView.mockResolvedValueOnce({ ok: true, canSend: true, sendBlockedReason: null, canView: true, inputRequestError: '입력 요청 조회에 실패했습니다.' })
    renderLane([watcher(LANE_KEY, { inputRequest: meta(60_000) })])
    await click(q('[data-input-badge]'))
    await flush()
    expect(q('[data-input-message="error"]')?.textContent).toBe('입력 요청 조회에 실패했습니다.')
    await click(q('[data-input-badge]')) // 닫기
    expect(q('[data-input-panel]')).toBeNull()
    getView.mockResolvedValueOnce({ ok: false, error: '세션 확인에 실패했습니다.' })
    await click(q('[data-input-badge]'))
    await flush()
    expect(q('[data-input-message="error"]')?.textContent).toBe('세션 확인에 실패했습니다.')
    expect(getView).toHaveBeenCalledTimes(2)
  })
})

// ───────────────────────── 웹에서 답하기

const reqView = (over: Record<string, unknown> = {}) => ({ kind: 'permission', since: since(60_000), handled: null, excerpt: ['계속할까요?', '1. 예', '2. 아니오'], sha: SHA, ...over })
const consoleView = (inputRequest: unknown, over: Partial<Extract<ConsoleViewResult, { ok: true }>> = {}): ConsoleViewResult =>
  ({ ok: true, canSend: true, sendBlockedReason: null, canView: true, prompts: [], screen: null, inputRequest, ...over }) as ConsoleViewResult
let consoleRun = 0
const renderConsole = async (view: ConsoleViewResult) => {
  getView.mockResolvedValue(view)
  // 호출마다 key 를 바꿔 새로 그린다 — 같은 인스턴스면 앞 응답(상태)이 남는다.
  act(() => root.render(<AgentConsole key={++consoleRun} seatKey={LANE_KEY} nowMs={NOW} />))
  await flush()
}
const keyBtn = (k: string) => q(`[data-console-key="${k}"]`) as HTMLButtonElement
const sendBtn = () => q('[data-input-send]') as HTMLButtonElement

describe('AgentConsole — 입력 요청 답하기', () => {
  it('주인이고 처리 전 permission 이면 키 버튼이 모두 있고 활성이다', async () => {
    await renderConsole(consoleView(reqView()))
    expect(q('[data-input-excerpt]')?.textContent).toContain('계속할까요?')
    const names = qa('[data-console-key]').map(b => b.getAttribute('data-console-key'))
    expect(names).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Esc', 'Up', 'Down', 'Tab'])
    expect(qa('[data-console-key]').every(b => !(b as HTMLButtonElement).disabled)).toBe(true)
    expect(sendBtn().disabled).toBe(true) // 쌓인 키가 없다
  })

  it('키를 쌓아 보내기를 누르면 sendConsoleKeys 에 화면이 보고 있는 입력 요청 값 그대로 보낸다', async () => {
    const r = reqView()
    sendKeys.mockResolvedValueOnce({ ok: true, id: 'k1' })
    await renderConsole(consoleView(r))
    await click(keyBtn('Down')); await click(keyBtn('Enter'))
    expect(q('[data-input-queue]')?.textContent).toContain('↓ → Enter')
    await click(sendBtn())
    expect(sendKeys).toHaveBeenCalledTimes(1)
    expect(sendKeys).toHaveBeenCalledWith(LANE_KEY, { kind: 'permission', since: r.since, sha: SHA }, ['Down', 'Enter'])
    expect(q('[data-input-result="ok"]')?.textContent).toContain('키를 보냈습니다')
    // 같은 화면에는 한 번만 — 보낸 뒤에는 버튼이 막힌다.
    expect(qa('[data-console-key]').every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(sendBtn().disabled).toBe(true)
  })

  it('이동 키는 최대 4개까지만 쌓이고 지우기로 비운다', async () => {
    await renderConsole(consoleView(reqView({ kind: 'choice' })))
    for (const k of ['Up', 'Down', 'Down', 'Up']) await click(keyBtn(k))
    expect(q('[data-input-queue]')?.textContent).toContain('(4/4)')
    expect(q('[data-input-queue]')?.textContent).toContain('↑ → ↓ → ↓ → ↑')
    expect(qa('[data-console-key]').every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(q('[data-input-keys-rule]')).toBeNull() // 확정 키가 없으니 규칙 안내는 필요 없다
    await click(q('[data-input-clear]'))
    expect(q('[data-input-queue]')?.textContent).toContain('쌓인 키가 없습니다')
    expect(keyBtn('3').disabled).toBe(false)
  })

  it('이동 키만 쌓아도 보낼 수 있다', async () => {
    sendKeys.mockResolvedValueOnce({ ok: true, id: 'k' })
    await renderConsole(consoleView(reqView({ kind: 'choice' })))
    await click(keyBtn('Down')); await click(keyBtn('Down')); await click(sendBtn())
    expect(sendKeys.mock.calls[0][2]).toEqual(['Down', 'Down'])
  })

  it('앞자리는 Up·Down 뿐 — Tab 을 쌓으면 확정 키처럼 이후 모든 키가 막히고, [Up, Tab] 은 보낼 수 있다', async () => {
    sendKeys.mockResolvedValueOnce({ ok: true, id: 'k' })
    await renderConsole(consoleView(reqView({ kind: 'choice' })))
    await click(keyBtn('Up')); await click(keyBtn('Tab'))
    expect(qa('[data-console-key]').every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(q('[data-input-keys-rule]')?.textContent).toBe(KEYS_RULE_TEXT)
    expect(sendBtn().disabled).toBe(false)
    await click(sendBtn())
    expect(sendKeys.mock.calls[0][2]).toEqual(['Up', 'Tab'])
  })

  it('확정 키(숫자·Enter·Esc)를 쌓으면 모든 키가 막히고 안내 문장이 나온다 — 지우면 되돌아온다', async () => {
    for (const confirm of ['2', 'Enter', 'Esc', 'Tab']) {
      await renderConsole(consoleView(reqView()))
      await click(keyBtn('Up')); await click(keyBtn(confirm))
      expect(qa('[data-console-key]').every(b => (b as HTMLButtonElement).disabled), confirm).toBe(true)
      expect(q('[data-input-keys-rule]')?.textContent, confirm).toBe(KEYS_RULE_TEXT)
      expect(sendBtn().disabled, confirm).toBe(false) // 이미 쌓은 목록은 규칙에 맞으니 보낼 수 있다
      await click(q('[data-input-clear]'))
      expect(q('[data-input-keys-rule]')).toBeNull()
      expect(qa('[data-console-key]').every(b => !(b as HTMLButtonElement).disabled)).toBe(true)
    }
  })

  it('서버가 bad_keys 로 거절해도 같은 안내 문장을 보인다', async () => {
    await renderConsole(consoleView(reqView()))
    sendKeys.mockResolvedValueOnce({ ok: false, code: 'bad_keys', error: 'x' })
    await click(keyBtn('1')); await click(sendBtn())
    expect(q('[data-input-result="error"]')?.textContent).toBe(KEYS_RULE_TEXT)
  })

  it('보내는 동안은 버튼이 막힌다', async () => {
    let done!: (v: ConsoleKeysResult) => void
    sendKeys.mockReturnValueOnce(new Promise<ConsoleKeysResult>(r => { done = r }))
    await renderConsole(consoleView(reqView({ kind: 'question' })))
    await click(keyBtn('2'))
    await click(sendBtn())
    expect(sendBtn().textContent).toContain('보내는 중')
    expect(sendBtn().disabled).toBe(true)
    expect(keyBtn('1').disabled).toBe(true)
    await act(async () => { done({ ok: true, id: 'k' }) })
    expect(q('[data-input-result="ok"]')).not.toBeNull()
  })

  it('세션 주인이 아니면 버튼을 그리지 않고 안내만 보인다', async () => {
    await renderConsole(consoleView(reqView(), { canSend: false, sendBlockedReason: '보내기는 이 세션의 주인 본인만 할 수 있습니다.' }))
    expect(q('[data-input-excerpt]')).not.toBeNull()
    expect(q('[data-console-key]')).toBeNull()
    expect(q('[data-input-send]')).toBeNull()
    expect(q('[data-input-owner-only]')?.textContent).toBe('답하기는 세션을 띄운 본인만 할 수 있습니다.')
  })

  it('처리된 요청·답할 수 없는 종류는 버튼이 비활성이다', async () => {
    await renderConsole(consoleView(reqView({ handled: { by: 'coordinator', at: since(10_000) } })))
    expect(qa('[data-console-key]').every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(q('[data-input-handled]')?.textContent).toContain('이미 처리된 요청입니다. 처리됨 (조정자)')
    for (const kind of ['usage-limit', 'trust', 'message']) {
      await renderConsole(consoleView(reqView({ kind })))
      expect(qa('[data-console-key]').every(b => (b as HTMLButtonElement).disabled), kind).toBe(true)
      expect(q('[data-input-not-answerable]')?.textContent, kind).toContain('웹에서 답할 수 없습니다')
    }
  })

  it('발췌를 볼 수 없으면(칸이 없으면) 입력 요청 구역도 버튼도 없다', async () => {
    await renderConsole({ ok: true, canSend: true, sendBlockedReason: null, canView: false })
    expect(q('[data-input-request]')).toBeNull()
    expect(q('[data-console-key]')).toBeNull()
  })

  it('결과 코드마다 한국어 안내를 보인다 — 창이 바뀌면 최신 화면을 다시 읽는다', async () => {
    await renderConsole(consoleView(reqView()))
    sendKeys.mockResolvedValueOnce({ ok: false, code: 'prompt_changed', error: 'x' })
    await click(keyBtn('1')); await click(sendBtn())
    expect(q('[data-input-result="error"]')?.textContent).toBe('창이 바뀌어 보내지 않았습니다. 최신 화면을 확인하세요.')
    expect(getView.mock.calls.length).toBeGreaterThanOrEqual(2) // 첫 조회 + 보낸 뒤 한 번
    sendKeys.mockResolvedValueOnce({ ok: false, code: 'already_sent', error: 'x' })
    await click(sendBtn())
    expect(q('[data-input-result="error"]')?.textContent).toBe('같은 화면에는 이미 답했습니다.')
    expect(sendBtn().disabled).toBe(true)
  })

  it.each([
    ['not_owner', '본인만'], ['not_answerable', '웹에서 답할 수 없습니다'], ['no_request', '입력 요청이 없습니다'],
    ['rate_limited', '너무 많이'], ['queue_full', '전달되지 않은'],
  ] as const)('코드 %s 안내', async (code, part) => {
    await renderConsole(consoleView(reqView()))
    sendKeys.mockResolvedValueOnce({ ok: false, code, error: 'x' })
    await click(keyBtn('1')); await click(sendBtn())
    expect(q('[data-input-result="error"]')?.textContent).toContain(part)
  })

  it('호출이 예외로 실패하면 메시지를 보이고 쌓은 키는 남긴다', async () => {
    await renderConsole(consoleView(reqView()))
    sendKeys.mockRejectedValueOnce(new Error('네트워크 오류'))
    await click(keyBtn('1')); await click(sendBtn())
    expect(q('[data-input-result="error"]')?.textContent).toBe('네트워크 오류')
    expect(q('[data-input-queue]')?.textContent).toContain('1')
    expect(sendBtn().disabled).toBe(false)
  })

  it('입력 요청이 바뀌면(발췌 해시) 쌓아 둔 키를 버린다', async () => {
    await renderConsole(consoleView(reqView()))
    await click(keyBtn('1'))
    expect(q('[data-input-queue]')?.textContent).toContain('(1/4)')
    getView.mockResolvedValue(consoleView(reqView({ sha: 'b'.repeat(64), excerpt: ['다른 창'] })))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(q('[data-input-excerpt]')?.textContent).toBe('다른 창')
    expect(q('[data-input-queue]')?.textContent).toContain('쌓인 키가 없습니다')
  })

  it('전달 상태 표에서 사유가 prompt_changed 인 거절은 「창이 바뀌어 보내지 않음」 으로 쓴다', async () => {
    await renderConsole(consoleView(null, {
      prompts: [
        { id: 'p1', text: '1 Enter', status: 'refused', reason: 'prompt_changed', createdAt: since(30_000) },
        { id: 'p2', text: '다른 글', status: 'refused', reason: 'bang-in-text', createdAt: since(40_000) },
      ],
    }))
    expect(qa('[data-console-reason]').map(e => e.textContent)).toEqual(['창이 바뀌어 보내지 않음', '사유: bang-in-text'])
  })
})

// ───────────────────────── 에이전트 보기

const leadSummary = (...runs: Record<string, unknown>[]) => {
  const r = parseLeadSummary({ v: 1, runs })
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const leadRun = (over: Record<string, unknown> = {}) => ({
  run: 'r1', decision: { pending_user: 1, open: 1, first_title: '배포해도 됩니까' }, merge: { in_flight: 'engine', queue: ['web'] },
  progress: { goal: '레인 요약', started_at: since(2 * 3_600_000), items_done: 3, items_total: 6 }, lanes: { working: 2, waiting: 0, done: 1, quiet: ['docs'] },
  resource: { band: 'normal', five: 30, week: 10, load_adjust: 1, banned: false }, alive: { last_tick_at: since(5 * 60_000) }, ...over,
})
const renderRoster = (watchers: Watcher[]) => {
  const roster = assembleRoster({ floors: [floorOf(watchers)] })
  act(() => root.render(<OfficeChatterContext.Provider value={false}><RosterBoard roster={roster} nowMs={NOW} /></OfficeChatterContext.Provider>))
}

describe('RosterBoard — 조정 팀장·임시 팀원', () => {
  it('조정 팀장 책상 카드에 결정 대기 배지가 붙고 상세에 1~6 순서로 보인다', async () => {
    renderRoster([watcher(COORD_KEY, { leadSummary: leadSummary(leadRun()) })])
    await flush()
    expect(q('[data-roster-desk] [data-lead-decision-badge]')?.textContent).toContain('결정 2건')
    const panel = q('[data-roster-profile] [data-lead-summary]')!
    expect(qa('[data-roster-profile] [data-lead-item]').map(e => e.getAttribute('data-order'))).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(panel.querySelector('[data-lead-item="decision"]')?.textContent).toContain('결정 대기 2건')
    expect(panel.querySelector('[data-lead-item="decision"]')?.textContent).toContain('배포해도 됩니까')
    expect(panel.querySelector('[data-lead-item="alive"]')?.getAttribute('data-tone')).toBe('ok')
  })

  it('마지막 tick 이 45분을 넘으면 alive 항목이 빨강(alert)이다', async () => {
    renderRoster([watcher(COORD_KEY, { leadSummary: leadSummary(leadRun({ alive: { last_tick_at: since(46 * 60_000) } })) })])
    await flush()
    expect(q('[data-lead-item="alive"]')?.getAttribute('data-tone')).toBe('alert')
  })

  it('회차가 여럿이면 회차별로 구분해 보인다', async () => {
    renderRoster([watcher(COORD_KEY, { leadSummary: leadSummary(leadRun(), leadRun({ run: 'r2', decision: {} })) })])
    await flush()
    expect(qa('[data-roster-profile] [data-lead-run]').map(e => e.getAttribute('data-lead-run'))).toEqual(['r1', 'r2'])
    expect(q('[data-lead-run="r2"] [data-lead-item="decision"]')?.getAttribute('data-tone')).toBe('muted')
  })

  it('요약이 없으면 상세에 「요약 없음」 이고 카드에 배지가 없다', async () => {
    renderRoster([watcher(COORD_KEY, { leadSummary: null })])
    await flush()
    expect(q('[data-lead-summary-none]')?.textContent).toBe('요약 없음')
    expect(q('[data-lead-decision-badge]')).toBeNull()
  })

  it('팀장 상세에 입력 대기 N건이 보이고 처리된 건은 기록 줄로만 남는다', async () => {
    renderRoster([
      watcher(COORD_KEY, { leadSummary: null }),
      watcher('hong/mbp/임시:a·x', { inputRequest: meta(60_000) }),
      watcher('hong/mbp/임시:b·y', { inputRequest: meta(9 * 60_000, { kind: 'question' }) }),
      watcher('hong/mbp/임시:c·z', { inputRequest: meta(9 * 60_000, { handled: { by: 'coordinator', at: '2026-10-06T08:58:00Z' } }) }),
      watcher('other/pc/임시:d·w', { inputRequest: meta(60_000) }), // 다른 PC 행은 세지 않는다
    ])
    await flush()
    expect(q('[data-lead-input-wait-n]')?.textContent).toBe('입력 대기 2건')
    expect(qa('[data-lead-input-records] li').map(e => e.textContent)).toEqual(['c 레인의 입력 요청(권한 요청)은 조정자가 17:58에 처리했습니다.'])
  })

  it('임시 팀원 책상 카드는 눌리지 않는 입력 대기 배지를 보이고, 고르면 상세에서 배지를 눌러 발췌를 연다', async () => {
    renderRoster([watcher(COORD_KEY), watcher(LANE_KEY, { inputRequest: meta(6 * 60_000) })])
    await flush()
    const card = q('[data-roster-desk="임시:eng·엔진"]')!
    expect(card.querySelector('[data-input-badge]')?.getAttribute('data-input-overdue')).toBe('true')
    expect(card.querySelector('button')).toBeNull() // 버튼 안에 버튼을 두지 않는다
    expect(q('[data-roster-profile] [data-input-badge]')).toBeNull() // 아직 팀장이 골라져 있다
    await click(card)
    await flush()
    const callsBefore = getView.mock.calls.filter(c => c[0] === LANE_KEY).length
    expect(callsBefore).toBe(1) // 콘솔(AgentConsole)의 기존 조회 하나
    getView.mockResolvedValueOnce(consoleView(reqView({ excerpt: ['발췌 한 줄'] })))
    await click(q('[data-roster-profile] [data-input-badge]'))
    await flush()
    expect(getView.mock.calls.filter(c => c[0] === LANE_KEY).length).toBe(callsBefore + 1)
    expect(q('[data-roster-profile] [data-input-excerpt]')?.textContent).toBe('발췌 한 줄')
    expect(qa('[data-roster-profile] [data-input-request]')).toHaveLength(1) // 콘솔이 같은 발췌를 두 번 그리지 않는다
  })
})

describe('키 순서 규칙(순수 함수)', () => {
  it('마지막 자리 전용 키는 숫자·Enter·Esc·Tab, 앞자리 키는 Up·Down', () => {
    for (const k of ['1', '5', '9', 'Enter', 'Esc', 'Tab'] as const) expect(isFinalKey(k), k).toBe(true)
    for (const k of ['Up', 'Down'] as const) expect(isFinalKey(k), k).toBe(false)
  })
  it('유효한 순서 — Up·Down 만, 앞자리 Up·Down 뒤 마지막 키 하나', () => {
    expect(isValidKeySequence(['Down'])).toBe(true)
    expect(isValidKeySequence(['Up', 'Down', 'Down', 'Up'])).toBe(true)
    expect(isValidKeySequence(['Up', 'Tab'])).toBe(true)
    expect(isValidKeySequence(['Down', 'Down', '2'])).toBe(true)
    expect(isValidKeySequence(['Up', 'Down', 'Up', 'Esc'])).toBe(true)
    expect(isValidKeySequence(['Tab'])).toBe(true)
    expect(isValidKeySequence(['Enter'])).toBe(true)
  })
  it('잘못된 순서 — 비었음·5개 이상·Tab 이나 확정 키가 앞자리·마지막 전용 키 둘', () => {
    expect(isValidKeySequence([])).toBe(false)
    expect(isValidKeySequence(['Up', 'Up', 'Up', 'Up', 'Up'])).toBe(false)
    expect(isValidKeySequence(['Tab', 'Up'])).toBe(false)
    expect(isValidKeySequence(['Tab', 'Tab'])).toBe(false)
    expect(isValidKeySequence(['1', 'Down'])).toBe(false)
    expect(isValidKeySequence(['1', 'Enter'])).toBe(false)
    expect(isValidKeySequence(['Down', 'Esc', 'Enter'])).toBe(false)
    expect(isValidKeySequence(['Up', 'Tab', 'Enter'])).toBe(false)
  })
  it('canAddKey — 마지막 전용 키(Tab 포함)가 쌓였으면 모두 막고, 4개에서도 막는다', () => {
    expect(canAddKey([], '1')).toBe(true)
    expect(canAddKey(['Up'], 'Tab')).toBe(true)
    expect(canAddKey(['Up', 'Down', 'Up'], 'Down')).toBe(true)
    expect(canAddKey(['Up', 'Down', 'Up', 'Down'], 'Down')).toBe(false)
    expect(canAddKey(['2'], 'Down')).toBe(false)
    expect(canAddKey(['Up', 'Tab'], 'Up')).toBe(false)
    expect(canAddKey(['Up', 'Esc'], '3')).toBe(false)
  })
})

describe('터미널 글 표시 — 발췌와 최근 화면이 같은 함수를 거친다', () => {
  const EVIL = 'echo \u202Eevil\u200B\u2028가짜 줄\u{E0041}'
  const SHOWN = 'echo ⟨U+202E⟩evil⟨U+200B⟩⟨U+2028⟩가짜 줄⟨U+E0041⟩'
  const noHidden = (t: string) => expect(t).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B\u2028\u2029\u{E0000}-\u{E007F}]/u)

  it('발췌는 기호로 그리고 pre 에 bidi-override 클래스가 붙는다', async () => {
    getView.mockResolvedValue(consoleView(reqView({ excerpt: [EVIL, '둘째 줄'] })))
    act(() => root.render(<AgentConsole key={++consoleRun} seatKey={LANE_KEY} nowMs={NOW} />))
    await flush()
    const pre = q('[data-input-excerpt]') as HTMLElement
    expect(pre.textContent).toBe(`${SHOWN}\n둘째 줄`)
    noHidden(pre.textContent!)
    expect(pre.className).toContain('termPre')
  })

  it('최근 화면도 같은 함수를 거치고 pre 에 bidi-override 클래스가 붙는다', async () => {
    getView.mockResolvedValue(consoleView(null, { screen: { lines: [EVIL, '$ ls'], capturedAt: since(30_000) } }))
    act(() => root.render(<AgentConsole key={++consoleRun} seatKey={LANE_KEY} nowMs={NOW} />))
    await flush()
    const pre = q('[data-console-screen]') as HTMLElement
    expect(pre.textContent).toBe(`${SHOWN}\n$ ls`)
    noHidden(pre.textContent!)
    expect(pre.className).toContain('termPre')
  })
})
