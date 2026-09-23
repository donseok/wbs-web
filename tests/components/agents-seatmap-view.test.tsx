// tests/components/agents-seatmap-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
const releaseLead = vi.fn()
vi.mock('@/app/actions/agentSeatmap', () => ({
  refreshSeatmap: (...a: unknown[]) => refresh(...(a as [])),
  releaseLeadLease: (...a: unknown[]) => releaseLead(...(a as [])),
}))
const runOp = vi.fn()
vi.mock('@/app/actions/agentHub', () => ({ runHubProcessOp: (...a: unknown[]) => runOp(...(a as [])) }))
vi.mock('@/app/actions/agentWork', () => ({ getReportDecisions: vi.fn(async () => ({ ok: true, decisions: [] })) }))
import { SeatmapView } from '@/components/agents/SeatmapView'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const map = (over: Partial<Seatmap> = {}): Seatmap => ({
  floors: [{
    id: 'p1', name: 'mes-base', seatCount: 2, doneCount: 0, watchers: [], leads: [],
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
// 기본 보기는 에이전트다(2026-09-19). 좌석을 다루는 테스트가 대부분이라 평면도를 기억해 둔 브라우저로 시작한다.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); refresh.mockReset(); runOp.mockReset(); releaseLead.mockReset(); window.localStorage.clear(); window.localStorage.setItem('dflow.office.view', 'floor'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('SeatmapView', () => {
  it('카운터·확인 필요·층이 그려지고, 팝업은 아무것도 고르지 않은 채로는 열리지 않는다', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    expect(host.textContent).toContain('mes-base')
    expect(host.querySelector('[data-hero-tile="active"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-hero-tile="offline"]')?.textContent).toBe('1')
    // 전체 스튜디오도 공통 헤더를 쓰고, 탭 자리에 층 칩(돌아갈 길)을 단다.
    expect(host.querySelector('[data-office-nav="all"]')?.getAttribute('aria-current')).toBe('page')
    expect(host.querySelector('a[data-office-nav="p1"]')?.getAttribute('href')).toBe('/p/p1/agents/office')
    // 상세는 팝업이다 — 페이지를 열자마자 뜨면 안 된다.
    expect(document.querySelector('[data-panel]')).toBeNull()
  })
  it('기억한 보기가 없으면 에이전트 보기로 열리고, 보기 버튼은 에이전트·평면도·상태 레인 순이다(2026-09-19)', () => {
    window.localStorage.clear()
    act(() => root.render(<SeatmapView initial={map()} />))
    expect([...host.querySelectorAll('button[data-view]')].map(b => b.getAttribute('data-view'))).toEqual(['agent', 'floor', 'lane'])
    expect(host.querySelector('button[data-view="agent"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-roster-board]')).not.toBeNull()
  })
  it('보기는 에이전트·평면도·상태 레인 셋이고, 에이전트는 작업 PC 로 묶은 자리와 프로필을 그린다(2026-09-18)', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    act(() => (host.querySelector('button[data-view="agent"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-roster-board]')).not.toBeNull()
    expect(host.querySelector('[data-roster-host="hong/mbp"]')?.textContent).toContain('팀원 1')
    // 결정 대기 자리를 먼저 고른다 — 질문이 프로필에 보인다.
    expect(host.querySelector('[data-roster-profile]')?.textContent).toContain('어느 DB?')
    // 완료 포함은 평면도 전용 — 보기 전환이 왼쪽에 고정돼 있어 빼도 밀리지 않는다.
    expect(host.querySelector('button[data-done-toggle]')).toBeNull()
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
    expect(host.querySelector('[data-hero-tile="active"]')?.textContent).toBe('9')
  })
  it('재조회가 실패하면 마지막 데이터를 유지하고 실패 시각을 표시한다', async () => {
    refresh.mockResolvedValue({ ok: false, error: 'boom' })
    act(() => root.render(<SeatmapView initial={map()} pollMs={1000} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(host.querySelector('[data-hero-tile="active"]')?.textContent).toBe('1')
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

describe('SeatmapView — 프로젝트 스튜디오(projectId)', () => {
  it('재조회에 projectId 를 넘기고 전체 스튜디오 링크가 보인다', async () => {
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
      id: 'p1', name: 'mes-base', seatCount: 1, doneCount: 0, watchers: [], leads: [],
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

  // 작업 중(ACTIVE) 좌석 — 중단 버튼만 뜬다.
  const activeSeat = (): Seatmap => map({
    floors: [{
      id: 'p1', name: 'mes-base', seatCount: 1, doneCount: 0, watchers: [], leads: [],
      zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, ready: 0, done: 0 }, seats: [
        { orderId: 'o7', id8: 'o7', projectId: 'p1', itemId: 'i7', code: 'TSK-04-07', name: '도는 중', state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat', agent: 'hong/mbp/w1', progress: 40, lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: null, heartbeatPhase: 'build', note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false, resumeRequestedAt: null, resumeRequestedHost: null, agentMine: false, agentOwnerName: null },
      ] }],
    }],
    attention: [],
  })
  it('중단은 곧바로 보내지 않고 상세 팝업에 확인을 띄운다 — 확정하면 보내고, 취소하면 아무 것도 안 한다', async () => {
    runOp.mockResolvedValue({ ok: true })
    refresh.mockResolvedValue({ ok: true, seatmap: activeSeat() })
    await act(async () => { root.render(<SeatmapView initial={activeSeat()} />) })
    await act(async () => { opButton('stop').click() })
    expect(runOp).not.toHaveBeenCalled()
    expect(document.querySelector('[data-op-note]')).toBeNull() // 사유 입력이 아니라 확인이다
    const box = document.querySelector('[data-op-confirm-box="stop"]')
    expect(box).not.toBeNull()
    expect(box!.textContent).toContain('워커는 다음 신호')
    await act(async () => { (document.querySelector('[data-op-cancel]') as HTMLButtonElement).click() })
    expect(document.querySelector('[data-op-confirm-box]')).toBeNull()
    expect(runOp).not.toHaveBeenCalled()
    await act(async () => { opButton('stop').click() })
    const go = document.querySelector('[data-op-confirm]') as HTMLButtonElement
    expect(go.disabled).toBe(false)
    expect(go.textContent).toBe('중단 확정')
    await act(async () => { go.click() })
    expect(runOp).toHaveBeenCalledWith('p1', { kind: 'stop', orderId: 'o7' })
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
      id: 'p1', name: 'mes-base', seatCount: 1, doneCount: 1, watchers: [], leads: [],
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
  it('상태 레인 보기에서는 토글을 쓸 수 없다 — 그 보기는 완료 레인을 늘 안고 있다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} />))
    const lane = [...host.querySelectorAll('button')].find(b => b.getAttribute('data-view') === 'lane') as HTMLButtonElement
    act(() => lane.click())
    expect(document.querySelector('[data-done-toggle]')).toBeNull()
  })
  it('프로젝트 스튜디오에서는 상태 레인일 때 토글을 아예 뺀다 — 보기 전환은 왼쪽에 고정돼 밀리지 않는다', () => {
    act(() => root.render(<SeatmapView initial={withDoneSeat()} projectId="11111111-1111-4111-8111-111111111111" projectName="P" />))
    const lane = [...host.querySelectorAll('button')].find(b => b.getAttribute('data-view') === 'lane') as HTMLButtonElement
    act(() => lane.click())
    expect(document.querySelector('[data-done-toggle]')).toBeNull()
  })
})

describe('SeatmapView — 잡담 켬/끔(2026-09-18)', () => {
  // 작업 중(ACTIVE)이고 보고가 없는 자리 — 켜 두면 세 칸에 한 칸 한마디를 한다.
  const working = (): Seatmap => map({
    floors: [{
      id: 'p1', name: 'mes-base', seatCount: 1, doneCount: 0, watchers: [], leads: [],
      zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, ready: 0, done: 0 }, seats: [
        { orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '도는 중', state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat', agent: 'hong/mbp/w1', progress: 40, lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: null, heartbeatPhase: 'build', note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false },
      ] }],
    }],
    attention: [],
  })
  const toggle = () => host.querySelector('[data-chatter-toggle]') as HTMLButtonElement
  /** 8초 칸을 여섯 번 넘기며 잡담 말풍선이 한 번이라도 뜨는지 본다. */
  const chatSeen = () => {
    let seen = false
    for (let k = 0; k < 6; k++) {
      act(() => { vi.advanceTimersByTime(8_000) })
      if (host.querySelector('[data-chat-bubble="chat"]')) seen = true
    }
    return seen
  }

  it('세 보기 모두에 토글이 있고 기본은 켬이다', () => {
    act(() => root.render(<SeatmapView initial={working()} />))
    for (const v of ['floor', 'lane', 'agent']) {
      act(() => (host.querySelector(`button[data-view="${v}"]`) as HTMLButtonElement).click())
      expect(toggle()?.getAttribute('aria-pressed')).toBe('true')
    }
  })
  it('켬이면 작업 중 팀원의 한마디가 뜨고, 끄면 사라진다', () => {
    act(() => root.render(<SeatmapView initial={working()} />))
    expect(chatSeen()).toBe(true)
    act(() => toggle().click())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(toggle().textContent).toContain('잡담 끔')
    expect(chatSeen()).toBe(false)
  })
  it('상태 레인에서도 끄면 한마디가 사라진다', () => {
    act(() => root.render(<SeatmapView initial={working()} />))
    act(() => (host.querySelector('button[data-view="lane"]') as HTMLButtonElement).click())
    expect(chatSeen()).toBe(true)
    act(() => toggle().click())
    expect(chatSeen()).toBe(false)
  })
  it('상태 레인의 승인 대기 카드도 승인을 조르고, 끄면 조용하다', () => {
    const w = working()
    Object.assign(w.floors[0].zones[0].seats[0], { state: 'WAIT', phase: 'reported', anim: 'idle_coffee' })
    act(() => root.render(<SeatmapView initial={w} />))
    act(() => (host.querySelector('button[data-view="lane"]') as HTMLButtonElement).click())
    expect(chatSeen()).toBe(true)
    act(() => toggle().click())
    expect(chatSeen()).toBe(false)
  })
  it('에이전트 보기의 빈 팀원 자리는 켬이면 부재 사유를, 끄면 빈자리만 보인다(2026-09-19)', () => {
    const w = working()
    w.floors[0].watchers = [{ agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, untilLabel: null, lastSeenAt: new Date(NOW - 5000).toISOString(), projectId: null }]
    act(() => root.render(<SeatmapView initial={w} />))
    act(() => (host.querySelector('button[data-view="agent"]') as HTMLButtonElement).click())
    const empties = () => [...host.querySelectorAll('[data-roster-desk="w2"], [data-roster-desk="w3"]')]
    expect(empties()).toHaveLength(2)
    for (const d of empties()) expect(d.textContent).toContain('자리 비움 · ')
    // 세 칸에 한 칸 말풍선 — 여섯 칸 안에 빈자리 말풍선이 한 번은 뜬다
    let seen = false
    for (let k = 0; k < 6; k++) {
      act(() => { vi.advanceTimersByTime(8_000) })
      if (empties().some(d => d.querySelector('[data-chat-bubble="empty"]'))) seen = true
    }
    expect(seen).toBe(true)
    act(() => toggle().click())
    for (const d of empties()) {
      expect(d.textContent).not.toContain('자리 비움')
      expect(d.textContent).toContain('빈자리')
      expect(d.querySelector('[data-chat-bubble]')).toBeNull()
    }
  })
  it('선택을 이 브라우저에 기억한다', () => {
    act(() => root.render(<SeatmapView initial={working()} />))
    act(() => toggle().click())
    expect(window.localStorage.getItem('dflow.office.chatter')).toBe('0')
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(<SeatmapView initial={working()} />))
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('SeatmapView — 팀장 lease 해제(0101)', () => {
  const withLead = (canRelease: boolean): Seatmap => map({
    floors: [{
      id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, watchers: [], zones: [],
      leads: [{
        userId: 'u9', host: 'air', agent: 'u9/air/lead', renewedAt: new Date(NOW - 5000).toISOString(),
        expiresAt: new Date(NOW + 120_000).toISOString(), mine: false, ownerName: '홍길동', canRelease,
      }],
    }],
    attention: [],
  })
  it('canRelease=true 면 「팀장 해제」→「정말 해제」로 releaseLeadLease 를 (floorId, userId) 로 부른다', async () => {
    releaseLead.mockResolvedValue({ ok: true, released: 1 })
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    await act(async () => { root.render(<SeatmapView initial={withLead(true)} />) })
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === '팀장 해제') as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    const confirm = host.querySelector('[data-lead-confirm]') as HTMLButtonElement
    expect(confirm?.textContent).toBe('정말 해제')
    await act(async () => { confirm.click() })
    expect(releaseLead).toHaveBeenCalledWith('p1', 'u9')
  })
  it('canRelease=false 면 「팀장 해제」 버튼이 없다', () => {
    act(() => root.render(<SeatmapView initial={withLead(false)} />))
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === '팀장 해제')
    expect(btn).toBeUndefined()
    expect(host.querySelector('[data-lead="u9"]')).not.toBeNull()
  })
})

// 스펙 §7("오피스 화면의 팀장 좌석에 lease 표시") — 기본 보기(에이전트, RosterBoard)의 팀장
// 책상에서도 같은 lease 정보·해제가 되는지 검증한다.
describe('SeatmapView — 팀장 lease 해제 · 에이전트 보기', () => {
  const withLead = (canRelease: boolean): Seatmap => map({
    floors: [{
      id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, zones: [],
      watchers: [{ agent: 'u9/air/lead', host: 'air', slots: 2, busy: 0, untilLabel: null, lastSeenAt: new Date(NOW - 5000).toISOString(), projectId: null }],
      leads: [{
        userId: 'u9', host: 'air', agent: 'u9/air/lead', renewedAt: new Date(NOW - 5000).toISOString(),
        expiresAt: new Date(NOW + 120_000).toISOString(), mine: false, ownerName: '홍길동', canRelease,
      }],
    }],
    attention: [],
  })
  // 전역 beforeEach 가 'dflow.office.view'='floor' 를 심어 두므로, 여기서 지워 저장된 보기가
  // 없는 첫 방문 상태(기본값 = 에이전트)를 그대로 검증한다.
  beforeEach(() => { window.localStorage.clear() })

  it('기본(에이전트) 보기의 팀장 책상에서도 「팀장 해제」→「정말 해제」로 releaseLeadLease 를 (projectId, userId) 로 부른다', async () => {
    releaseLead.mockResolvedValue({ ok: true, released: 1 })
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    await act(async () => { root.render(<SeatmapView initial={withLead(true)} />) })
    expect(host.querySelector('[data-roster-board]')).not.toBeNull() // 기본 보기가 실제로 에이전트임을 확인
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === '팀장 해제') as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    const confirm = host.querySelector('[data-lead-confirm]') as HTMLButtonElement
    expect(confirm?.textContent).toBe('정말 해제')
    await act(async () => { confirm.click() })
    expect(releaseLead).toHaveBeenCalledWith('p1', 'u9')
  })

  it('canRelease=false 면 에이전트 보기에도 「팀장 해제」 버튼이 없다', () => {
    act(() => root.render(<SeatmapView initial={withLead(false)} />))
    expect(host.querySelector('[data-roster-board]')).not.toBeNull()
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === '팀장 해제')
    expect(btn).toBeUndefined()
    expect(host.querySelector('[data-lead="u9"]')).not.toBeNull()
  })

  it('해제 실패는 갱신 실패 배너가 아니라 「팀장 해제 실패」 제 이름의 배너로 보인다', async () => {
    releaseLead.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    await act(async () => { root.render(<SeatmapView initial={withLead(true)} />) })
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === '팀장 해제') as HTMLButtonElement
    await act(async () => { btn.click() })
    await act(async () => { (host.querySelector('[data-lead-confirm]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-lead-error]')?.textContent).toContain('팀장 해제 실패')
    expect(host.querySelector('[data-lead-error]')?.textContent).toContain('권한이 없습니다.')
    expect(host.querySelector('[data-error]')).toBeNull() // 갱신 실패 배너와 문구가 섞이지 않는다
  })

  // scope=mine 이 다른 계정의 감시자는 지우지만 그 lease 는 남긴다(관리자가 풀 수 있어야 하므로) —
  // 짝이 되는 감시자가 없으면 RosterBoard 는 책상을 지어내지 않고 목록 위 별도 띠에 보인다.
  it('짝이 되는 감시자가 없는 lease 도 별도 띠에서 「팀장 해제」가 된다', async () => {
    releaseLead.mockResolvedValue({ ok: true, released: 1 })
    refresh.mockResolvedValue({ ok: true, seatmap: map() })
    const noWatcher: Seatmap = map({
      floors: [{
        id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, watchers: [], zones: [],
        leads: [{
          userId: 'u9', host: 'air', agent: 'u9/air/lead', renewedAt: new Date(NOW - 5000).toISOString(),
          expiresAt: new Date(NOW + 120_000).toISOString(), mine: false, ownerName: '홍길동', canRelease: true,
        }],
      }],
      attention: [],
    })
    await act(async () => { root.render(<SeatmapView initial={noWatcher} />) })
    expect(host.querySelector('[data-roster-unmatched-leads]')).not.toBeNull()
    const btn = [...host.querySelectorAll('[data-roster-unmatched-leads] button')].find(b => b.textContent === '팀장 해제') as HTMLButtonElement
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    await act(async () => { (host.querySelector('[data-lead-confirm]') as HTMLButtonElement).click() })
    expect(releaseLead).toHaveBeenCalledWith('p1', 'u9')
  })
})

