// tests/components/agents-seatmap-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
vi.mock('@/app/actions/agentSeatmap', () => ({ refreshSeatmap: (...a: unknown[]) => refresh(...(a as [])) }))
const runOp = vi.fn()
vi.mock('@/app/actions/agentHub', () => ({ runHubProcessOp: (...a: unknown[]) => runOp(...(a as [])) }))
import { SeatmapView } from '@/components/agents/SeatmapView'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const map = (over: Partial<Seatmap> = {}): Seatmap => ({
  floors: [{
    id: 'p1', name: 'mes-base', seatCount: 2, doneCount: 0, watchers: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, ready: 1, done: 0 }, seats: [
      { orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '목록', state: 'BLOCKED', phase: 'blocked', anim: 'blocked', character: 'cat', agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: null, heartbeatPhase: 'blocked', note: '어느 DB?', rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false },
      { orderId: 'o2', id8: 'o2', projectId: 'p1', itemId: 'i2', code: 'TSK-04-02', name: '상세', state: 'READY', phase: 'design', anim: 'empty', character: 'bot', agent: null, progress: 0, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null, note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false },
    ] }],
  }],
  counters: { active: 1, standby: 0, idle: 0, offline: 1 },
  attention: [{ orderId: 'o1', id8: 'o1', floorName: 'mes-base', code: 'TSK-04-01', name: '목록', state: 'BLOCKED', why: '어느 DB?' }],
  fetchedAt: new Date(NOW).toISOString(), scope: 'mine', ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); refresh.mockReset(); runOp.mockReset(); window.localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('SeatmapView', () => {
  it('카운터·확인 필요·층이 그려지고, 팝업은 아무것도 고르지 않은 채로는 열리지 않는다', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    expect(host.textContent).toContain('mes-base')
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-counter="offline"]')?.textContent).toBe('1')
    // 상세는 팝업이다 — 페이지를 열자마자 뜨면 안 된다.
    expect(document.querySelector('[data-panel]')).toBeNull()
  })
  it('보기는 평면도·상태 레인·에이전트 셋이고, 에이전트는 작업 PC 로 묶은 자리와 프로필을 그린다(2026-09-18)', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    expect([...host.querySelectorAll('button[data-view]')].map(b => b.getAttribute('data-view'))).toEqual(['floor', 'lane', 'agent'])
    act(() => (host.querySelector('button[data-view="agent"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-roster-board]')).not.toBeNull()
    expect(host.querySelector('[data-roster-host="hong/mbp"]')?.textContent).toContain('팀원 1')
    // 결정 대기 자리를 먼저 고른다 — 질문이 프로필에 보인다.
    expect(host.querySelector('[data-roster-profile]')?.textContent).toContain('어느 DB?')
    expect(host.querySelector('button[data-done-toggle]')).toBeNull() // 완료 포함은 평면도 전용
    expect(window.localStorage.getItem('dflow.office.view')).toBe('agent')
  })
  it('확인 필요 띠를 누르면 그 좌석의 상세 팝업이 열린다', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    const btn = host.querySelector('[aria-label="확인 필요"] button') as HTMLButtonElement
    act(() => btn.click())
    const panel = document.querySelector('[data-panel]')
    expect(panel?.textContent).toContain('어느 DB?')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('TSK-04-01')
  })
  it('확인 필요 띠의 버튼에 층(프로젝트) 이름이 보인다', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    expect(host.querySelector('[aria-label="확인 필요"]')?.textContent).toContain('mes-base')
  })
  it('갱신 스탬프는 서버·클라이언트 로컬 타임존과 무관하게 KST(Asia/Seoul) 기준으로 찍힌다', () => {
    // NOW = 2026-09-14T09:00:00Z → KST 18:00:00. 이 실행 환경의 ICU 는 ko-KR 을 "18시 0분 0초" 로 렌더한다
    // (콜론 포맷이 아니다) — 프로세스 TZ 와 무관하게 이 문자열이면 timeZone 고정이 실제로 적용된 것이다.
    act(() => root.render(<SeatmapView initial={map()} />))
    expect(host.textContent).toContain('18시 0분 0초')
  })
  it('책상을 누르면 그 좌석의 상세 팝업이 열리고, 닫으면 사라진다', () => {
    act(() => root.render(<SeatmapView initial={map({ attention: [] })} />))
    const desk = [...host.querySelectorAll('button[aria-pressed]')].find(b => b.textContent?.includes('TSK-04-02')) as HTMLButtonElement
    act(() => desk.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('TSK-04-02')
    const close = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.getAttribute('aria-label')?.includes('닫')) as HTMLButtonElement
    if (close) { act(() => close.click()); expect(document.querySelector('[data-panel]')).toBeNull() }
  })
  it('30초마다 refreshSeatmap 을 부르고 결과로 갈아 끼운다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map({ counters: { active: 9, standby: 0, idle: 0, offline: 0 } }) })
    act(() => root.render(<SeatmapView initial={map()} pollMs={30_000} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('9')
  })
  it('재조회가 실패하면 마지막 데이터를 유지하고 실패 시각을 표시한다', async () => {
    refresh.mockResolvedValue({ ok: false, error: 'boom' })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-error]')?.textContent).toContain('갱신 실패')
    expect(host.querySelector('[data-error]')?.textContent).toContain('boom')
  })
  it('탭이 숨겨지면 폴링하지 않고, 다시 보이면 즉시 1회 재조회한다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(refresh).toHaveBeenCalledTimes(0)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('SeatmapView — 내 작업 / 전체 전환', () => {
  it('기본은 내 작업이고, 전체를 누르면 즉시 scope=all 로 재조회하며 이후 폴링도 그 범위로 간다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map({ scope: 'all' }) })
    await act(async () => { root.render(<SeatmapView initial={map()} pollMs={30_000} />) })
    const mine = [...host.querySelectorAll('button')].find(b => b.textContent === '내 작업') as HTMLButtonElement
    const all = [...host.querySelectorAll('button')].find(b => b.textContent === '전체') as HTMLButtonElement
    expect(mine.getAttribute('aria-pressed')).toBe('true')
    expect(all.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { all.click() })
    expect(refresh).toHaveBeenCalledWith('all')
    expect(all.getAttribute('aria-pressed')).toBe('true')
    refresh.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(refresh).toHaveBeenCalledWith('all')
  })
  it('내 작업에 아무것도 없으면 전체로 바꿔 보라는 안내가 뜬다', async () => {
    await act(async () => { root.render(<SeatmapView initial={map({ floors: [], attention: [], counters: { active: 0, standby: 0, idle: 0, offline: 0 } })} />) })
    expect(host.textContent).toContain('배정된 에이전트 작업이 없습니다')
  })
})

describe('SeatmapView — 프로젝트 오피스(projectId)', () => {
  it('재조회에 projectId 를 넘기고 전체 오피스 링크가 보인다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} projectId="p1" />))
    expect((host.querySelector('[data-office-all-link]') as HTMLAnchorElement).getAttribute('href')).toBe('/agents')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).toHaveBeenCalledWith('mine', 'p1')
  })
  it('projectId 없으면 링크가 없고 재조회는 범위만 넘긴다', async () => {
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    expect(host.querySelector('[data-office-all-link]')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).toHaveBeenCalledWith('mine')
  })
  it('층이 비고 범위가 전체면 프로젝트에 위임이 없다는 문구', () => {
    act(() => root.render(<SeatmapView initial={map({ floors: [], attention: [], counters: { active: 0, standby: 0, idle: 0, offline: 0 }, scope: 'all' })} projectId="p1" />))
    expect(host.textContent).toContain('이 프로젝트에 위임된 주문이 없습니다. 위임·승인 탭에서 리프 항목에 위임을 켜면 좌석이 생깁니다.')
    expect(host.textContent).not.toContain('표시할 주문이 없습니다')
    expect(host.textContent).not.toContain('내게 배정된')
  })
  it('층이 비고 범위가 내 작업이면 전체로 바꿔 보라는 안내', () => {
    act(() => root.render(<SeatmapView initial={map({ floors: [], attention: [], counters: { active: 0, standby: 0, idle: 0, offline: 0 }, scope: 'mine' })} projectId="p1" />))
    expect(host.textContent).toContain('이 프로젝트에서 내게 배정된 에이전트 작업이 없습니다. 다른 사람 것까지 보려면 ‘전체’를 누르세요.')
    expect(host.textContent).not.toContain('위임·승인 탭에서')
    expect(host.textContent).not.toContain('배정된 에이전트 작업이 없습니다. 담당자가')
  })
})

describe('SeatmapView — 좌석에서 바로 결재', () => {
  // WAIT 좌석 하나짜리 좌석표 — 승인(사유 없음)과 반려(사유 필수)가 둘 다 뜬다.
  const waitSeat = (): Seatmap => map({
    floors: [{
      id: 'p1', name: 'mes-base', seatCount: 1, doneCount: 0, watchers: [],
      zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 0, wait: 1, ready: 0, done: 0 }, seats: [
        { orderId: 'o9', id8: 'o9', projectId: 'p1', itemId: 'i9', code: 'TSK-04-09', name: '승인 대기 건', state: 'WAIT', phase: 'verify', anim: 'empty', character: 'bot', agent: 'hong/mbp/w1', progress: 100, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null, note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false },
      ] }],
    }],
    attention: [],
  })
  const opButton = (label: string) =>
    [...host.querySelectorAll('[data-seat-op]')].find(b => b.getAttribute('data-seat-op') === label) as HTMLButtonElement

  it('승인은 상세 팝업을 열지 않고 바로 실행한다', async () => {
    runOp.mockResolvedValue({ ok: true })
    refresh.mockResolvedValue({ ok: true, seatmap: waitSeat() })
    await act(async () => { root.render(<SeatmapView initial={waitSeat()} />) })
    await act(async () => { opButton('approve').click() })
    expect(runOp).toHaveBeenCalledWith('p1', { kind: 'approve', orderId: 'o9' })
    // 결재하려고 누른 것이지 상세를 보려고 누른 것이 아니다.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('반려는 사유를 받아야 하므로 상세 팝업을 열고, 곧바로 서버를 부르지 않는다', async () => {
    await act(async () => { root.render(<SeatmapView initial={waitSeat()} />) })
    await act(async () => { opButton('reject').click() })
    expect(runOp).not.toHaveBeenCalled()
    expect(document.querySelector('[data-op-note]')).not.toBeNull()
  })

  it('승인이 실패하면 그 좌석의 상세 팝업을 열어 사유를 보여 준다', async () => {
    runOp.mockResolvedValue({ ok: false, error: '이미 승인된 주문입니다' })
    await act(async () => { root.render(<SeatmapView initial={waitSeat()} />) })
    await act(async () => { opButton('approve').click() })
    expect(document.querySelector('[data-op-error]')?.textContent).toContain('이미 승인된 주문입니다')
  })
})

describe('SeatmapView — 완료 포함 보기', () => {
  // 진행 중 한 자리와 머지 완료 한 자리가 같은 구역에 있는 층.
  const withDoneSeat = (): Seatmap => map({
    floors: [{
      id: 'p1', name: 'mes-base', seatCount: 1, doneCount: 1, watchers: [],
      zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, ready: 0, done: 1 }, seats: [
        { orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '도는 중', state: 'ACTIVE', phase: 'typing', anim: 'typing', character: 'cat', agent: 'hong/mbp/w1', progress: 40, lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: null, heartbeatPhase: 'typing', note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false },
        { orderId: 'o2', id8: 'o2', projectId: 'p1', itemId: 'i2', code: 'TSK-04-02', name: '승인된 건', state: 'DONE', phase: 'verify', anim: 'empty', character: 'bot', agent: null, progress: 100, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null, note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false },
      ] }],
    }],
    attention: [],
  })
  const toggle = () => host.querySelector('[data-done-toggle]') as HTMLButtonElement

  it('기본은 꺼짐 — 완료 좌석은 평면도에 없고, 안내가 켜는 길을 준다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    expect(host.textContent).toContain('TSK-04-01')
    expect(host.textContent).not.toContain('TSK-04-02')
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('[data-goto-done]')).not.toBeNull()
  })
  it('켜면 완료 좌석이 평면도에 그려지고 안내가 사라진다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    act(() => toggle().click())
    expect(host.textContent).toContain('TSK-04-02')
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-goto-done]')).toBeNull()
  })
  it('켜면 구역 요약과 층 머리에 완료 수가 붙는다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    act(() => toggle().click())
    expect(host.textContent).toContain('1 완료')
    expect(host.textContent).toContain('완료 1')
  })
  it('선택을 이 브라우저에 기억한다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    act(() => toggle().click())
    expect(window.localStorage.getItem('dflow.office.done')).toBe('1')
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('TSK-04-02')
  })
  it('상태 레인 보기에서는 토글이 없다 — 그 보기는 완료 레인을 늘 안고 있다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    const lane = [...host.querySelectorAll('button')].find(b => b.getAttribute('data-view') === 'lane') as HTMLButtonElement
    act(() => lane.click())
    expect(host.querySelector('[data-done-toggle]')).toBeNull()
  })
})
