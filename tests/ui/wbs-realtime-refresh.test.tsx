// @vitest-environment jsdom
// WbsRealtimeRefresh — 집계 화면(대시보드)용. 행 단위 패치가 정의되지 않는 값이라 서버에
// 다시 묻는 수밖에 없고, 그 왕복이 비싸므로 버스트를 접고 흩어서 보낸다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type BroadcastCb = (msg: { payload?: unknown }) => void
type SubscribeCb = (status: string) => void

const h = vi.hoisted(() => ({
  broadcastCb: null as BroadcastCb | null,
  subscribeCb: null as SubscribeCb | null,
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: (_t: string, _f: unknown, cb: BroadcastCb) => { h.broadcastCb = cb; return channel },
      subscribe: (cb: SubscribeCb) => { h.subscribeCb = cb; return channel },
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      realtime: { setAuth: vi.fn() },
      channel: () => channel,
      removeChannel: vi.fn(),
    }
  },
}))

const { WbsRealtimeRefresh } = await import('@/components/wbs/WbsRealtimeRefresh')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  h.refresh.mockClear()
  h.broadcastCb = null
  h.subscribeCb = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const PAYLOAD = (n: number) => ({ payload: {
  id: `i${n}`, project_id: 'p1', stage: 'ip', actual_pct: n,
  updated_at: `2026-09-17T0${n}:00:00.000Z`,
} })

async function mount() {
  // getSession 이 async 라 마운트 직후 마이크로태스크를 흘려야 구독이 걸린다.
  await act(async () => {
    root.render(
      <WbsRealtimeRefresh projectId="a1b2c3d4-0000-4000-8000-000000000001"
        delayMs={10_000} maxWaitMs={10_000} jitterMs={0} />,
    )
  })
}

describe('WbsRealtimeRefresh', () => {
  it('신호가 없으면 아무것도 하지 않는다', async () => {
    await mount()
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('연속 신호 5건을 재조회 1회로 접는다', async () => {
    await mount()
    // 1초 간격 5건 — t=0..4000 에 신호, 루프가 끝난 시각은 t=5000 이라 아직 상한(10_000) 전이다.
    await act(async () => {
      for (let n = 1; n <= 5; n++) { h.broadcastCb!(PAYLOAD(n)); vi.advanceTimersByTime(1_000) }
    })
    expect(h.refresh).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(5_000) }) // t=10_000 — 상한 도달
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('재연결 보정도 재조회를 예약한다', async () => {
    await mount()
    await act(async () => { h.subscribeCb!('SUBSCRIBED') })   // 최초 — 보정 없음
    await act(async () => { h.subscribeCb!('SUBSCRIBED') })   // 재연결
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('언마운트 뒤에는 예약된 재조회가 실행되지 않는다', async () => {
    await mount()
    await act(async () => { h.broadcastCb!(PAYLOAD(1)) })
    await act(async () => { root.unmount() })
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(h.refresh).not.toHaveBeenCalled()
    root = createRoot(container) // afterEach 의 unmount 가 터지지 않게
  })
})
