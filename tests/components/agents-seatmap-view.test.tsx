// tests/components/agents-seatmap-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
vi.mock('@/app/actions/agentSeatmap', () => ({ refreshSeatmap: (...a: unknown[]) => refresh(...(a as [])) }))
import { SeatmapView } from '@/components/agents/SeatmapView'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const map = (over: Partial<Seatmap> = {}): Seatmap => ({
  floors: [{
    id: 'p1', name: 'mes-base', seatCount: 2, doneCount: 0, watchers: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 1, wait: 0, ready: 1 }, seats: [
      { orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '목록', state: 'BLOCKED', phase: 'blocked', anim: 'idle_look', character: 'cat_dev', agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: null, heartbeatPhase: 'blocked', note: '어느 DB?', rejected: false, reviewNote: null, waitReason: null },
      { orderId: 'o2', id8: 'o2', projectId: 'p1', itemId: 'i2', code: 'TSK-04-02', name: '상세', state: 'READY', phase: 'design', anim: 'empty', character: 'dome_bot', agent: null, progress: 0, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null, note: null, rejected: false, reviewNote: null, waitReason: null },
    ] }],
  }],
  counters: { active: 1, standby: 0, idle: 0, offline: 1 },
  attention: [{ orderId: 'o1', id8: 'o1', floorName: 'mes-base', code: 'TSK-04-01', name: '목록', state: 'BLOCKED', why: '어느 DB?' }],
  fetchedAt: new Date(NOW).toISOString(), scope: 'mine', ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); refresh.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('SeatmapView', () => {
  it('카운터·확인 필요·층이 그려지고, 첫 확인 필요 항목이 선택되어 상세에 질문이 보인다', () => {
    act(() => root.render(<SeatmapView initial={map()} />))
    expect(host.textContent).toContain('mes-base')
    expect(host.querySelector('[data-counter="active"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-counter="offline"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-panel]')?.textContent).toContain('어느 DB?')
    expect(host.querySelector('[data-panel]')?.textContent).toContain('TSK-04-01')
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
  it('확인 필요 버튼을 누르면 그 책상이 선택된다', () => {
    act(() => root.render(<SeatmapView initial={map({ attention: [] })} />))
    const desk = [...host.querySelectorAll('button[aria-pressed]')].find(b => b.textContent?.includes('TSK-04-02')) as HTMLButtonElement
    act(() => desk.click())
    expect(host.querySelector('[data-panel]')?.textContent).toContain('TSK-04-02')
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
