// tests/components/agent-console.test.tsx — 오피스 콘솔 컨테이너(읽기·보내기·초안·좌석 바뀜)와 프로필·상세 연결(2026-10-06).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ConsoleViewResult } from '@/app/actions/agentHub'
import type { Seat, Seatmap, Floor, Watcher } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getView = vi.fn<(key: string) => Promise<ConsoleViewResult>>()
const send = vi.fn<(key: string, text: string) => Promise<{ ok: true } | { ok: false; error: string }>>()
vi.mock('@/app/actions/agentHub', () => ({
  getConsoleView: (k: string) => getView(k),
  sendConsolePrompt: (k: string, t: string) => send(k, t),
}))
vi.mock('@/app/actions/agentWork', () => ({ getReportDecisions: vi.fn(async () => ({ ok: true, decisions: [] })) }))
const refresh = vi.fn()
vi.mock('@/app/actions/agentSeatmap', () => ({ refreshSeatmap: (...a: unknown[]) => refresh(...(a as [])), releaseLeadLease: vi.fn() }))
import { AgentConsole, ConsoleDraftProvider, hasConsole } from '@/components/agents/AgentConsole'
import { DetailPanel } from '@/components/agents/DetailPanel'
import { RosterBoard } from '@/components/agents/RosterBoard'
import { SeatmapView } from '@/components/agents/SeatmapView'
import { assembleRoster } from '@/lib/domain/agentRoster'

const NOW = Date.parse('2026-10-06T09:00:00Z')
const W1 = 'hong/mbp/w1'
const W2 = 'hong/mbp/w2'
const view = (over: Partial<Extract<ConsoleViewResult, { ok: true }>> = {}): ConsoleViewResult => ({
  ok: true, canSend: true, sendBlockedReason: null, canView: true,
  prompts: [{ id: 'p1', text: '상태 알려줘', status: 'sent', reason: null, createdAt: new Date(NOW - 60_000).toISOString() }],
  screen: { lines: ['$ npm test', 'ok'], capturedAt: new Date(NOW - 30_000).toISOString() },
  ...over,
})
/** 바깥에서 푸는 약속 — 늦게 오는 응답을 흉내 낸다. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  getView.mockReset(); send.mockReset(); refresh.mockReset()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const q = (sel: string) => host.querySelector(sel)
const input = () => q('[data-console-input]') as HTMLTextAreaElement
const type = (text: string) => act(() => {
  const el = input()
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

/** 오피스(SeatmapView)처럼 초안 저장소를 쥐고 자리를 바꾸는 틀 — show=false 면 콘솔이 사라진다. */
function Office({ seatKey, show = true }: { seatKey: string; show?: boolean }) {
  return <ConsoleDraftProvider>{show && <AgentConsole key={seatKey} seatKey={seatKey} nowMs={NOW} />}</ConsoleDraftProvider>
}
const clickSend = () => act(async () => { (q('[data-console-send]') as HTMLButtonElement).click() })

describe('hasConsole', () => {
  it('대상 규칙에 맞는 신원만, 팀원 좌석이면 세션이 앉아 있을 때만', () => {
    expect(hasConsole(W1)).toBe(true)
    expect(hasConsole('hong/mbp/lead')).toBe(true)
    expect(hasConsole('hong/mbp/coord:abcd1234')).toBe(true)
    expect(hasConsole('hong/mbp/poll')).toBe(false)
    expect(hasConsole('hong/mbp/coord')).toBe(false)
    expect(hasConsole(null)).toBe(false)
    for (const s of ['ACTIVE', 'REJECTED', 'BLOCKED', 'STALE', 'OFFLINE'] as const) expect(hasConsole(W1, s)).toBe(true)
    for (const s of ['READY', 'WAIT', 'DONE'] as const) expect(hasConsole(W1, s)).toBe(false)
  })
})

describe('AgentConsole — 읽기', () => {
  it('대상이 아닌 좌석은 아무것도 그리지 않고 서버도 부르지 않는다', async () => {
    act(() => root.render(<AgentConsole seatKey="hong/mbp/poll" nowMs={NOW} />))
    await flush()
    expect(host.innerHTML).toBe('')
    expect(getView).not.toHaveBeenCalled()
  })
  it('읽는 동안 안내를 보이고, 도착하면 전달 상태와 화면을 그린다', async () => {
    const d = deferred<ConsoleViewResult>()
    getView.mockReturnValueOnce(d.promise)
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    expect(q('[data-console-loading="team_worker"]')?.textContent).toContain('콘솔을 읽는 중')
    expect(q('[data-console-loading]')?.textContent).toContain('팀원 w1')
    await act(async () => { d.resolve(view()) })
    expect(getView).toHaveBeenCalledWith(W1)
    expect(q('[data-console-target]')?.getAttribute('data-console-target')).toBe(W1)
    expect(q('[data-console-prompt="sent"]')?.textContent).toContain('상태 알려줘')
    expect(q('[data-console-screen]')?.textContent).toContain('$ npm test')
  })
  it('남의 세션(보내기 불가)이면 사유를 보이고, 전달 상태는 받아도 그리지 않는다', async () => {
    getView.mockResolvedValueOnce(view({ canSend: false, sendBlockedReason: '보내기는 세션 주인 본인만 할 수 있습니다.' }))
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    expect(q('[data-console-send-blocked]')?.textContent).toContain('본인만')
    expect(q('[data-console-input]')).toBeNull()
    expect(q('[data-console-prompts]')).toBeNull()
    expect(host.textContent).not.toContain('전달 상태')
  })
  it('화면 조회만 실패하면 화면 칸에 실패를 보인다(없음으로 위장하지 않는다)', async () => {
    getView.mockResolvedValueOnce(view({ screen: undefined, screenError: '화면 조회에 실패했습니다.' }))
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    expect(q('[data-console-screen-error]')?.textContent).toBe('화면 조회에 실패했습니다.')
    expect(q('[data-console-screen-empty]')).toBeNull()
  })
  it('첫 조회가 실패하면 읽는 중 칸에 오류를 보인다', async () => {
    getView.mockResolvedValueOnce({ ok: false, error: '세션 확인에 실패했습니다.' })
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    expect(q('[data-console-loading] [data-console-view-error]')?.textContent).toBe('세션 확인에 실패했습니다.')
    expect(q('[data-console]')).toBeNull()
  })
  it('던진 예외도 오류로 보인다', async () => {
    getView.mockRejectedValueOnce(new Error('네트워크 끊김'))
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    expect(q('[data-console-view-error]')?.textContent).toBe('네트워크 끊김')
  })
  it('30초마다 다시 읽고, 재조회만 실패하면 지난 값을 두고 실패를 따로 알린다', async () => {
    getView.mockResolvedValueOnce(view()).mockResolvedValueOnce({ ok: false, error: '로그인이 필요합니다.' })
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    await act(async () => { vi.advanceTimersByTime(30_000) })
    await flush()
    expect(getView).toHaveBeenCalledTimes(2)
    expect(q('[data-console-screen]')?.textContent).toContain('$ npm test')
    expect(q('[data-console-view-error]')?.textContent).toBe('콘솔 갱신 실패 · 로그인이 필요합니다.')
  })
  it('탭이 숨겨져 있으면 주기 조회를 쉰다', async () => {
    getView.mockResolvedValue(view())
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(getView).toHaveBeenCalledTimes(1)
    } finally { vis.mockRestore() }
  })
  it('탭이 다시 보이면 주기를 기다리지 않고 바로 읽는다', async () => {
    getView.mockResolvedValue(view())
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(getView).toHaveBeenCalledTimes(2)
  })
  it('사라지면 주기 조회와 탭 감시를 멈춘다', async () => {
    getView.mockResolvedValue(view())
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    act(() => root.render(<></>))
    await act(async () => { vi.advanceTimersByTime(90_000); document.dispatchEvent(new Event('visibilitychange')) })
    expect(getView).toHaveBeenCalledTimes(1)
  })
  it('글자 수 안내는 낭독 영역 밖에 두고, 문제 문구만 낭독한다', async () => {
    getView.mockResolvedValue(view())
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    expect(q('[data-console-hint]')?.getAttribute('aria-live')).toBeNull()
    expect(q('[data-console-issue-live]')?.textContent).toBe('')
    type('안녕!')
    expect(q('[data-console-issue-live]')?.textContent).toContain('느낌표')
  })
  it('좌석이 바뀐 뒤 늦게 도착한 앞 좌석의 응답은 버린다', async () => {
    const late = deferred<ConsoleViewResult>()
    getView.mockImplementation(k => (k === W1 ? late.promise : Promise.resolve(view({ screen: { lines: ['w2 화면'], capturedAt: new Date(NOW).toISOString() } }))))
    // key 없이 seatKey 만 바꾼다 — 같은 인스턴스에서도 앞 좌석의 응답이 섞이지 않아야 한다.
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    act(() => root.render(<AgentConsole seatKey={W2} nowMs={NOW} />))
    await flush()
    await act(async () => { late.resolve(view({ screen: { lines: ['w1 화면'], capturedAt: new Date(NOW).toISOString() } })) })
    await flush()
    expect(q('[data-console-target]')?.getAttribute('data-console-target')).toBe(W2)
    expect(q('[data-console-screen]')?.textContent).toContain('w2 화면')
    expect(host.textContent).not.toContain('w1 화면')
  })
})

describe('AgentConsole — 보내기·초안', () => {
  it('보내기는 정리한 글을 보내고, 성공하면 초안을 비우고 다시 읽는다', async () => {
    getView.mockResolvedValue(view())
    send.mockResolvedValueOnce({ ok: true })
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    type('  테스트\n돌려줘 ')
    await clickSend()
    await flush()
    expect(send).toHaveBeenCalledWith(W1, '테스트 돌려줘')
    expect(input().value).toBe('')
    expect(getView).toHaveBeenCalledTimes(2)
  })
  it('보내기가 거절되면 사유를 보이고 초안은 남긴다', async () => {
    getView.mockResolvedValue(view())
    send.mockResolvedValueOnce({ ok: false, error: '1분에 5건까지 보낼 수 있습니다.' })
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    type('상태 알려줘')
    await clickSend()
    await flush()
    expect(q('[data-console-send-error]')?.textContent).toBe('1분에 5건까지 보낼 수 있습니다.')
    expect(input().value).toBe('상태 알려줘')
    expect(getView).toHaveBeenCalledTimes(1)
  })
  it('오피스가 쥔 초안은 콘솔이 사라졌다 돌아와도 남고, 좌석마다 따로다', async () => {
    getView.mockResolvedValue(view())
    act(() => root.render(<Office seatKey={W1} />))
    await flush()
    type('w1 에게')
    act(() => root.render(<Office seatKey={W1} show={false} />))
    expect(q('[data-console-input]')).toBeNull()
    act(() => root.render(<Office seatKey={W2} />))
    await flush()
    expect(input().value).toBe('')
    act(() => root.render(<Office seatKey={W1} />))
    await flush()
    expect(input().value).toBe('w1 에게')
  })
  it('보내는 동안은 초안을 비우고 잠근다 — 자리를 떠났다 돌아와도 같은 글을 다시 보낼 수 없다', async () => {
    getView.mockResolvedValue(view())
    const d = deferred<{ ok: true }>()
    send.mockReturnValueOnce(d.promise)
    act(() => root.render(<Office seatKey={W1} />))
    await flush()
    type('한 번만')
    await clickSend()
    expect(input().value).toBe('')
    expect(input().readOnly).toBe(true)
    expect((q('[data-console-send]') as HTMLButtonElement).disabled).toBe(true)
    act(() => root.render(<Office seatKey={W1} show={false} />))
    act(() => root.render(<Office seatKey={W1} />))
    await flush()
    expect(input().value).toBe('')
    expect((q('[data-console-send]') as HTMLButtonElement).disabled).toBe(true)
    const reads = getView.mock.calls.length
    await act(async () => { d.resolve({ ok: true }) })
    expect(send).toHaveBeenCalledTimes(1)
    // 보낸 인스턴스는 이미 사라졌다 — 그 성공 처리가 다시 읽지 않는다.
    expect(getView).toHaveBeenCalledTimes(reads)
  })
  it('실패하면 초안을 되돌리되, 그사이 새로 쓴 글은 덮어쓰지 않는다', async () => {
    getView.mockResolvedValue(view())
    const first = deferred<{ ok: false; error: string }>()
    send.mockReturnValueOnce(first.promise)
    act(() => root.render(<Office seatKey={W1} />))
    await flush()
    type('첫 글')
    await clickSend()
    // 응답 전에 떠났다 돌아와 새 글을 쓴다.
    act(() => root.render(<Office seatKey={W1} show={false} />))
    act(() => root.render(<Office seatKey={W1} />))
    await flush()
    type('둘째 글')
    await act(async () => { first.resolve({ ok: false, error: '대기열이 가득 찼습니다.' }) })
    expect(input().value).toBe('둘째 글')
  })
  it('보내기 뒤 조회보다 늦게 온 앞선 주기 조회는 버린다(새 프롬프트가 사라지지 않게)', async () => {
    const stale = deferred<ConsoleViewResult>()
    const fresh = view({ prompts: [{ id: 'p2', text: '새 지시', status: 'pending', reason: null, createdAt: new Date(NOW).toISOString() }] })
    getView.mockResolvedValueOnce(view()).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(fresh)
    send.mockResolvedValueOnce({ ok: true })
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    await act(async () => { vi.advanceTimersByTime(30_000) }) // 주기 조회가 떠난다(아직 안 옴)
    type('새 지시')
    await clickSend()
    await flush()
    expect(q('[data-console-prompt="pending"]')?.textContent).toContain('새 지시')
    await act(async () => { stale.resolve(view()) })
    await flush()
    expect(q('[data-console-prompt="pending"]')?.textContent).toContain('새 지시')
  })
  it('저장소가 없으면 컴포넌트 안에서 초안을 쥔다', async () => {
    getView.mockResolvedValue(view())
    act(() => root.render(<AgentConsole seatKey={W1} nowMs={NOW} />))
    await flush()
    type('혼자')
    expect(input().value).toBe('혼자')
  })
})

describe('연결 — 평면도 상세·에이전트 보기 프로필', () => {
  const seat = (over: Partial<Seat> = {}): Seat => ({
    orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '목록',
    state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat', agent: W1, progress: 60,
    lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: new Date(NOW - 5000).toISOString(), heartbeatPhase: 'build',
    note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false, resumeRequestedAt: null, ...over,
  }) as Seat
  const OPS = { busy: false, note: null, opError: null, onOp: () => {}, onNoteChange: () => {}, onNoteConfirm: () => {}, onNoteCancel: () => {} } as const
  const watcher = (agent: string): Watcher =>
    ({ agent, host: null, slots: 2, busy: 0, untilLabel: null, lastSeenAt: new Date(NOW - 60_000).toISOString(), projectId: null })
  const floor = (watchers: Watcher[]): Floor => ({ id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, watchers, leads: [], zones: [] })

  beforeEach(() => { getView.mockResolvedValue(view()) })

  it('상세 — 세션이 앉은 팀원 좌석에만 콘솔을 꽂는다', async () => {
    act(() => root.render(<DetailPanel seat={seat({ state: 'BLOCKED' })} nowMs={NOW} {...OPS} />))
    await flush()
    expect(q('[data-detail-console] [data-console-target]')?.getAttribute('data-console-target')).toBe(W1)
    act(() => root.render(<DetailPanel seat={seat({ state: 'WAIT' })} nowMs={NOW} {...OPS} />))
    expect(q('[data-detail-console]')).toBeNull()
    act(() => root.render(<DetailPanel seat={seat({ state: 'ACTIVE', agent: null })} nowMs={NOW} {...OPS} />))
    expect(q('[data-detail-console]')).toBeNull()
  })
  it('프로필 — 고른 팀장 자리에 콘솔이 붙고, 단독 감시 자리는 붙지 않는다', async () => {
    act(() => root.render(<RosterBoard roster={assembleRoster({ floors: [floor([watcher('hong/mbp/lead')])] })} nowMs={NOW} />))
    await flush()
    expect(q('[data-roster-profile] [data-roster-console] [data-console="team_lead"]')).not.toBeNull()
    expect(getView).toHaveBeenCalledWith('hong/mbp/lead')
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(<RosterBoard roster={assembleRoster({ floors: [floor([watcher('hong/mbp/poll')])] })} nowMs={NOW} />))
    expect(q('[data-roster-profile]')).not.toBeNull()
    expect(q('[data-roster-console]')).toBeNull()
  })
  const seatFloor = (s: Seat): Floor => ({ ...floor([]), seatCount: 1, zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, ready: 0, done: 0 }, seats: [s] }] })
  it('프로필 — 팀원 책상은 세션이 앉아 있을 때만 콘솔이 붙는다', async () => {
    act(() => root.render(<RosterBoard roster={assembleRoster({ floors: [seatFloor(seat({ state: 'STALE' }))] })} nowMs={NOW} />))
    const desk = host.querySelector('[data-roster-desk="w1"]') as HTMLButtonElement
    act(() => desk.click())
    await flush()
    expect(q('[data-roster-profile] [data-roster-console] [data-console="team_worker"]')).not.toBeNull()
    act(() => root.render(<RosterBoard roster={assembleRoster({ floors: [seatFloor(seat({ state: 'DONE' }))] })} nowMs={NOW} />))
    expect(q('[data-roster-console]')).toBeNull()
  })
  it('오피스 — 상세 팝업을 닫았다 열어도, 30초 갱신이 좌석표를 갈아 끼워도 쓰던 글이 남는다', async () => {
    const sm = (): Seatmap => ({
      floors: [seatFloor(seat({ state: 'BLOCKED' }))], counters: { active: 0, standby: 0, idle: 0, offline: 0 },
      attention: [], fetchedAt: new Date(NOW).toISOString(), scope: 'mine',
    })
    refresh.mockResolvedValue({ ok: true, seatmap: sm() })
    window.localStorage.setItem('dflow.office.view', 'floor')
    try {
      act(() => root.render(<SeatmapView initial={sm()} pollMs={30_000} />))
      const openDesk = () => act(() => ([...host.querySelectorAll('button[aria-pressed]')].find(b => b.textContent?.includes('TSK-04-01')) as HTMLButtonElement).click())
      openDesk()
      await flush()
      const ta = () => document.querySelector('[data-detail-console] [data-console-input]') as HTMLTextAreaElement
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta(), '어느 DB 냐면')
        ta().dispatchEvent(new Event('input', { bubbles: true }))
      })
      const close = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.getAttribute('aria-label')?.includes('닫')) as HTMLButtonElement
      act(() => close.click())
      expect(document.querySelector('[data-detail-console]')).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(refresh).toHaveBeenCalled()
      openDesk()
      await flush()
      expect(ta().value).toBe('어느 DB 냐면')
    } finally { window.localStorage.clear() }
  })
})
