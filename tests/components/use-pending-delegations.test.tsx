// tests/components/use-pending-delegations.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { usePendingDelegations, HUB_SAVE_DEBOUNCE_MS, type PendingChange } from '@/components/agent-hub/usePendingDelegations'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Hook = ReturnType<typeof usePendingDelegations<string>>
type HarnessProps = {
  serverValues: ReadonlyMap<string, boolean>
  commit: (changes: PendingChange[]) => Promise<string>
  onResult: (res: string, sent: PendingChange[]) => void
  onError?: (message: string, sent: PendingChange[]) => void
  expose: (h: Hook) => void
}
function Harness({ expose, ...opts }: HarnessProps) {
  const h = usePendingDelegations<string>(opts)
  expose(h)
  return <span data-a={String(h.value('a'))} data-b={String(h.value('b'))} data-pending={String(h.isPending)} data-saving={String(h.saving)} data-count={h.count} />
}

let host: HTMLDivElement, root: Root
let hook: Hook
const commit = vi.fn(), onResult = vi.fn(), onError = vi.fn()
const server = (a: boolean, b = false) => new Map([['a', a], ['b', b]])
const render = (serverValues = server(false)) =>
  act(() => root.render(<Harness serverValues={serverValues} commit={commit} onResult={onResult} onError={onError} expose={h => { hook = h }} />))
const el = () => host.querySelector('span') as HTMLElement
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  commit.mockReset(); onResult.mockReset(); onError.mockReset()
  commit.mockResolvedValue('ok')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('usePendingDelegations', () => {
  it('서버값과 다른 값만 대기에 들어가고, 지연 뒤 묶음 1건으로 commit → onResult', async () => {
    render()
    act(() => hook.set('a', true))
    expect(el().dataset.a).toBe('true'); expect(el().dataset.pending).toBe('true'); expect(el().dataset.count).toBe('1')
    expect(hook.remainingMs).toBe(HUB_SAVE_DEBOUNCE_MS)
    await tick(HUB_SAVE_DEBOUNCE_MS - 1)
    expect(commit).not.toHaveBeenCalled()
    await tick(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith([{ itemId: 'a', delegated: true }])
    expect(onResult).toHaveBeenCalledWith('ok', [{ itemId: 'a', delegated: true }])
    expect(el().dataset.pending).toBe('false'); expect(el().dataset.saving).toBe('false')
    // 부모가 응답의 서버값으로 다시 그리면 그 값이 보인다.
    render(server(true))
    expect(el().dataset.a).toBe('true')
  })
  it('켰다 끄면(서버값으로 복귀) 대기에서 빠지고 commit 하지 않는다', async () => {
    render()
    act(() => hook.set('a', true))
    act(() => hook.set('a', false))
    expect(el().dataset.pending).toBe('false'); expect(hook.remainingMs).toBeNull()
    await tick(HUB_SAVE_DEBOUNCE_MS)
    expect(commit).not.toHaveBeenCalled()
  })
  it('연달아 바꾼 항목은 마지막 체크 기준으로 한 묶음에 실린다', async () => {
    render()
    act(() => hook.set('a', true))
    await tick(1000)
    act(() => hook.setMany([['b', true]]))
    await tick(1000)
    expect(commit).not.toHaveBeenCalled() // 타이머가 재시작됐다.
    await tick(500)
    expect(commit).toHaveBeenCalledWith([{ itemId: 'a', delegated: true }, { itemId: 'b', delegated: true }])
  })
  it('flush() 는 기다리지 않고 바로 보낸다', async () => {
    render()
    act(() => hook.set('a', true))
    await act(async () => { await hook.flush() })
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('저장 중 되돌린 체크는 사라지지 않는다 — 보낸 값과 다르므로 다음 묶음에 실린다', async () => {
    let resolve!: (v: string) => void
    commit.mockImplementationOnce(() => new Promise<string>(r => { resolve = r }))
    render()
    act(() => hook.set('a', true))
    await tick(HUB_SAVE_DEBOUNCE_MS)
    expect(el().dataset.saving).toBe('true')
    act(() => hook.set('a', false)) // 기준은 서버값(false)이 아니라 보내는 중인 값(true)
    expect(el().dataset.a).toBe('false'); expect(el().dataset.count).toBe('1')
    await act(async () => { resolve('ok') })
    render(server(true)) // 응답으로 서버값이 true 가 됐다
    expect(el().dataset.a).toBe('false') // 대기 false 가 살아 있다
    await tick(HUB_SAVE_DEBOUNCE_MS)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit.mock.calls[1][0]).toEqual([{ itemId: 'a', delegated: false }])
  })
  it('서버값이 바뀌어 대기값과 같아지면(새로고침 등) 대기를 버리고 commit 하지 않는다', async () => {
    render()
    act(() => hook.set('a', true))
    render(server(true))
    expect(el().dataset.pending).toBe('false')
    await tick(HUB_SAVE_DEBOUNCE_MS)
    expect(commit).not.toHaveBeenCalled()
  })
  it('commit 이 throw 하면 보낸 항목을 대기에서 빼고(서버값으로 복귀) onError 로 알린다', async () => {
    commit.mockRejectedValueOnce(new Error('network'))
    render()
    act(() => hook.set('a', true))
    await tick(HUB_SAVE_DEBOUNCE_MS)
    expect(onError).toHaveBeenCalledWith('network', [{ itemId: 'a', delegated: true }])
    expect(onResult).not.toHaveBeenCalled()
    expect(el().dataset.a).toBe('false'); expect(el().dataset.pending).toBe('false')
  })
  it('언마운트 시 대기분은 분리 저장된다 — commit 은 부르고 onResult 는 부르지 않는다', async () => {
    render()
    act(() => hook.set('a', true))
    await act(async () => { root.unmount() })
    root = createRoot(host) // afterEach 의 unmount 가 두 번 되지 않게 새 루트를 둔다.
    await act(async () => { await Promise.resolve() })
    expect(commit).toHaveBeenCalledWith([{ itemId: 'a', delegated: true }])
    expect(onResult).not.toHaveBeenCalled()
  })
})
