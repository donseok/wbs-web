// @vitest-environment jsdom
// useWbsRealtime — 구독 배선 자체보다 "틀리기 쉬운 규칙" 셋을 고정한다.
//   1) 최초 SUBSCRIBED 에서는 보정하지 않는다(SSR 결과가 이미 최신이다).
//   2) 두 번째 이후 SUBSCRIBED(= 끊겼다 붙음)에서만 누락분을 보정한다.
//   3) 언마운트에서 removeChannel — 채널 leak 1순위 함정.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type SubscribeCb = (status: string) => void
type BroadcastCb = (msg: { payload?: unknown }) => void

const h = vi.hoisted(() => ({
  clientThrows: false,
  session: { user: { id: 'u1' } } as { user: { id: string } } | null,
  subscribeCb: null as SubscribeCb | null,
  broadcastCb: null as BroadcastCb | null,
  channelName: '' as string,
  channelOpts: null as unknown,
  removeChannel: vi.fn(),
  setAuth: vi.fn(),
  channelFactory: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    // 실제 @supabase/ssr 은 URL·키가 없으면 여기서 던진다. 향상 계층이라 그래도 화면이 죽으면 안 된다.
    if (h.clientThrows) throw new Error('Your project URL and API key are required')
    const channel = {
      on: (_type: string, _filter: unknown, cb: BroadcastCb) => { h.broadcastCb = cb; return channel },
      subscribe: (cb: SubscribeCb) => { h.subscribeCb = cb; return channel },
    }
    return {
      auth: { getSession: async () => ({ data: { session: h.session } }) },
      realtime: { setAuth: h.setAuth },
      channel: (name: string, opts: unknown) => {
        h.channelName = name
        h.channelOpts = opts
        h.channelFactory(name)
        return channel
      },
      removeChannel: h.removeChannel,
    }
  },
}))

const { useWbsRealtime } = await import('@/lib/hooks/useWbsRealtime')

function Probe({ onChange, onReconnect }: { onChange: (p: unknown) => void; onReconnect: () => void }) {
  useWbsRealtime({ projectId: 'a1b2c3d4-0000-4000-8000-000000000001', onChange, onReconnect })
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  h.clientThrows = false
  h.session = { user: { id: 'u1' } }
  h.subscribeCb = null
  h.broadcastCb = null
  h.channelName = ''
  h.removeChannel.mockClear()
  h.setAuth.mockClear()
  h.channelFactory.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function mount(onChange = vi.fn(), onReconnect = vi.fn()) {
  await act(async () => { root.render(<Probe onChange={onChange} onReconnect={onReconnect} />) })
  return { onChange, onReconnect }
}

describe('useWbsRealtime', () => {
  it('프로젝트 private 채널을 연다', async () => {
    await mount()
    expect(h.channelName).toBe('project-a1b2c3d4-0000-4000-8000-000000000001-wbs')
    expect(h.channelOpts).toEqual({ config: { private: true } })
    expect(h.setAuth).toHaveBeenCalled()
  })

  it('최초 SUBSCRIBED 에서는 보정하지 않는다', async () => {
    const { onReconnect } = await mount()
    await act(async () => { h.subscribeCb!('SUBSCRIBED') })
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('두 번째 SUBSCRIBED 에서만 보정한다', async () => {
    const { onReconnect } = await mount()
    await act(async () => { h.subscribeCb!('SUBSCRIBED') })
    await act(async () => { h.subscribeCb!('CHANNEL_ERROR') })
    await act(async () => { h.subscribeCb!('SUBSCRIBED') })
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('SUBSCRIBED 가 아닌 상태는 보정을 부르지 않는다', async () => {
    const { onReconnect } = await mount()
    await act(async () => { h.subscribeCb!('TIMED_OUT') })
    await act(async () => { h.subscribeCb!('CLOSED') })
    expect(onReconnect).not.toHaveBeenCalled()
  })

  it('broadcast 페이로드를 해석해 onChange 로 넘긴다', async () => {
    const { onChange } = await mount()
    await act(async () => {
      h.broadcastCb!({ payload: {
        id: 'i1', project_id: 'p1', stage: 'im', actual_pct: 80,
        updated_at: '2026-09-17T01:00:00.000Z',
      } })
    })
    expect(onChange).toHaveBeenCalledWith({
      id: 'i1', projectId: 'p1', stage: 'im', actualPct: 80,
      updatedAt: '2026-09-17T01:00:00.000Z',
    })
  })

  it('형태가 어긋난 페이로드는 onChange 로 넘기지 않는다', async () => {
    const { onChange } = await mount()
    await act(async () => { h.broadcastCb!({ payload: { nope: true } }) })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('언마운트에서 채널을 정리한다', async () => {
    await mount()
    await act(async () => { root.unmount() })
    expect(h.removeChannel).toHaveBeenCalledTimes(1)
    // afterEach 의 두 번째 unmount 가 터지지 않도록 새 root 를 깔아 둔다.
    root = createRoot(container)
  })

  it('세션이 없으면 구독하지 않는다', async () => {
    h.session = null
    await mount()
    expect(h.channelFactory).not.toHaveBeenCalled()
  })

  it('supabase 클라이언트 생성이 실패해도 던지지 않는다 — 향상 계층', async () => {
    h.clientThrows = true
    await expect(mount()).resolves.toBeDefined()
    expect(h.channelFactory).not.toHaveBeenCalled()
  })

  it('콜백이 매 렌더 새 함수여도 다시 구독하지 않는다', async () => {
    await act(async () => { root.render(<Probe onChange={() => {}} onReconnect={() => {}} />) })
    await act(async () => { root.render(<Probe onChange={() => {}} onReconnect={() => {}} />) })
    await act(async () => { root.render(<Probe onChange={() => {}} onReconnect={() => {}} />) })
    // 재구독 루프(구독 → refresh → 새 콜백 → effect 재실행)가 이 프로젝트에서 실제로 났던 함정이다.
    expect(h.channelFactory).toHaveBeenCalledTimes(1)
  })
})
