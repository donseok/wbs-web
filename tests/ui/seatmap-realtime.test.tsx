// @vitest-environment jsdom
// SeatmapRealtime — 오피스가 층마다 0098 채널을 듣고, 신호가 오면 좌석표를 한 번 재조회한다.
// 2026-09-18 실측: done 보고마다 서버는 wbs_changed 를 쐈지만 오피스만 듣지 않아 30초 폴링을 기다렸다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Args = { projectId: string; onChange: (p: unknown) => void; onReconnect?: () => void }
const h = vi.hoisted(() => ({ subs: new Map<string, Args>() }))
vi.mock('@/lib/hooks/useWbsRealtime', () => ({
  useWbsRealtime: (a: Args) => { h.subs.set(a.projectId, a) },
}))

const { SeatmapRealtime } = await import('@/components/agents/SeatmapRealtime')

let container: HTMLDivElement
let root: Root
const run = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  run.mockClear()
  h.subs.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const mount = (ids: string[]) => act(() => { root.render(<SeatmapRealtime projectIds={ids} run={run} />) })

describe('SeatmapRealtime', () => {
  it('층(프로젝트)마다 채널을 하나씩 듣는다', () => {
    mount(['p1', 'p2'])
    expect([...h.subs.keys()].sort()).toEqual(['p1', 'p2'])
  })

  it('여러 층에서 신호가 겹쳐도 재조회는 한 번이다', () => {
    mount(['p1', 'p2'])
    act(() => {
      h.subs.get('p1')!.onChange({})
      h.subs.get('p2')!.onChange({})
      h.subs.get('p1')!.onChange({})
    })
    expect(run).not.toHaveBeenCalled() // 버스트를 접는 중이다
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('상한(5초)+지터(2초) 안에 반드시 재조회한다 — 신호가 계속 와도 미뤄지지만은 않는다', () => {
    mount(['p1'])
    for (let t = 0; t < 7_000; t += 500) {
      act(() => { h.subs.get('p1')!.onChange({}); vi.advanceTimersByTime(500) })
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('끊겼다 다시 붙으면 그 사이 누락분을 메우려고 재조회한다', () => {
    mount(['p1'])
    act(() => { h.subs.get('p1')!.onReconnect!() })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('언마운트하면 대기 중인 재조회가 남지 않는다', () => {
    mount(['p1'])
    act(() => { h.subs.get('p1')!.onChange({}) })
    act(() => root.unmount())
    root = createRoot(container) // afterEach 의 unmount 대상
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()
  })
})
