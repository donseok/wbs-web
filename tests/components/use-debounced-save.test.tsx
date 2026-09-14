// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SAVE_DEBOUNCE_MS, useDebouncedSave } from '@/components/wbs/useDebouncedSave'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Fields = { priority: string | null; delegate: boolean }
type Res = { ok: boolean; error?: string; warning?: string }
type Hook = ReturnType<typeof useDebouncedSave<Fields, Res>>

const commitPriority = vi.fn<(v: string | null) => Promise<Res>>()
const commitDelegate = vi.fn<(v: boolean) => Promise<Res>>()
const onSaved = vi.fn()
const onFailed = vi.fn()
const onFlushed = vi.fn()

let latest: Hook | null = null
let container: HTMLDivElement
let root: Root

function Harness({ scope, baseline }: { scope: string; baseline: Fields | null }) {
  latest = useDebouncedSave<Fields, Res>({
    scope, baseline,
    commit: { priority: commitPriority, delegate: commitDelegate },
    onSaved, onFailed, onFlushed,
  })
  return <span data-pending={String(latest.isPending)} data-saving={String(latest.saving)} />
}

const BASE: Fields = { priority: 'high', delegate: false }

async function mount(scope = 'item-1', baseline: Fields | null = BASE) {
  await act(async () => { root.render(<Harness scope={scope} baseline={baseline} />) })
}
async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
const h = () => latest!

describe('useDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    commitPriority.mockReset().mockResolvedValue({ ok: true })
    commitDelegate.mockReset().mockResolvedValue({ ok: true })
    onSaved.mockReset(); onFailed.mockReset(); onFlushed.mockReset()
    latest = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('SAVE_DEBOUNCE_MS 가 지나야 저장한다 — 그 전에는 서버를 부르지 않는다', async () => {
    await mount()
    await act(async () => { h().set('priority', 'low') })
    expect(h().isPending).toBe(true)
    expect(h().view).toEqual({ priority: 'low', delegate: false }) // 낙관 표시
    await tick(SAVE_DEBOUNCE_MS - 1)
    expect(commitPriority).not.toHaveBeenCalled()
    await tick(1)
    expect(commitPriority).toHaveBeenCalledTimes(1)
    expect(commitPriority).toHaveBeenCalledWith('low')
    expect(onSaved).toHaveBeenCalledWith('priority', 'low', { ok: true })
    expect(onFlushed).toHaveBeenCalledTimes(1)
    expect(onFlushed).toHaveBeenCalledWith({ saved: ['priority'], detached: false })
    expect(h().isPending).toBe(false)
  })

  it('변경이 이어지면 타이머가 재시작된다 — 마지막 변경 뒤 SAVE_DEBOUNCE_MS', async () => {
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await tick(SAVE_DEBOUNCE_MS - 1000)
    await act(async () => { h().set('delegate', true) })
    await tick(SAVE_DEBOUNCE_MS - 1000)
    expect(commitPriority).not.toHaveBeenCalled()
    expect(commitDelegate).not.toHaveBeenCalled()
    await tick(1000)
    expect(commitPriority).toHaveBeenCalledTimes(1)
    expect(commitDelegate).toHaveBeenCalledTimes(1)
  })

  it('같은 필드를 여러 번 바꾸면 마지막 값만 저장한다', async () => {
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await act(async () => { h().set('priority', 'medium') })
    await act(async () => { h().set('priority', 'critical') })
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitPriority).toHaveBeenCalledTimes(1)
    expect(commitPriority).toHaveBeenCalledWith('critical')
  })

  it('원래 값으로 되돌아온 필드는 저장하지 않는다 — 위임 on 뒤 off', async () => {
    await mount()
    await act(async () => { h().set('delegate', true) })
    expect(h().isPending).toBe(true)
    await act(async () => { h().set('delegate', false) })
    expect(h().isPending).toBe(false)
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitDelegate).not.toHaveBeenCalled()
    expect(onFlushed).not.toHaveBeenCalled()
  })

  it('여러 필드가 한 flush 에 들어가면 순서대로 직렬 호출하고 onFlushed 는 1회다', async () => {
    const order: string[] = []
    commitPriority.mockImplementation(async () => { order.push('priority:start'); await Promise.resolve(); order.push('priority:end'); return { ok: true } })
    commitDelegate.mockImplementation(async () => { order.push('delegate:start'); await Promise.resolve(); order.push('delegate:end'); return { ok: true } })
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await act(async () => { h().set('delegate', true) })
    await tick(SAVE_DEBOUNCE_MS)
    expect(order).toEqual(['priority:start', 'priority:end', 'delegate:start', 'delegate:end'])
    expect(onFlushed).toHaveBeenCalledTimes(1)
    expect(onFlushed).toHaveBeenCalledWith({ saved: ['priority', 'delegate'], detached: false })
  })

  it('flush() 로 즉시 저장한다 — 「지금 저장」', async () => {
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await act(async () => { await h().flush() })
    expect(commitPriority).toHaveBeenCalledWith('low')
    expect(h().isPending).toBe(false)
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitPriority).toHaveBeenCalledTimes(1) // 타이머가 다시 쏘지 않는다
  })

  it('저장 실패 — pending 에서 빼서 view 가 원래 값으로 돌아가고 onFailed 로 오류를 알린다', async () => {
    commitPriority.mockResolvedValue({ ok: false, error: '권한이 없습니다' })
    await mount()
    await act(async () => { h().set('priority', 'low') })
    expect(h().view?.priority).toBe('low')
    await tick(SAVE_DEBOUNCE_MS)
    expect(onFailed).toHaveBeenCalledWith('priority', 'low', '권한이 없습니다')
    expect(onSaved).not.toHaveBeenCalled()
    expect(h().view?.priority).toBe('high')
    expect(h().isPending).toBe(false)
    // 성공한 필드가 없으면 refresh 를 부를 이유가 없다
    expect(onFlushed).not.toHaveBeenCalled()
  })

  it('실패와 성공이 섞이면 성공한 필드만 saved 에 담아 onFlushed 1회', async () => {
    commitPriority.mockResolvedValue({ ok: false, error: '실패' })
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await act(async () => { h().set('delegate', true) })
    await tick(SAVE_DEBOUNCE_MS)
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(onFlushed).toHaveBeenCalledWith({ saved: ['delegate'], detached: false })
  })

  it('언마운트(패널 닫힘) 시 대기 중인 변경을 즉시 flush 한다 — 상태 콜백 없이 refresh 만', async () => {
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await act(async () => { root.unmount() })
    root = createRoot(container) // afterEach 의 unmount 가 두 번 되지 않게
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(commitPriority).toHaveBeenCalledWith('low')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onFlushed).toHaveBeenCalledWith({ saved: ['priority'], detached: true })
  })

  it('scope(itemId) 가 바뀌면 이전 항목의 변경을 원래 commit 으로 flush 하고 새 항목은 비어 있다', async () => {
    await mount('item-1')
    await act(async () => { h().set('priority', 'low') })
    const firstCommit = commitPriority.mock
    await mount('item-2', { priority: 'medium', delegate: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(firstCommit.calls).toEqual([['low']])
    expect(onFlushed).toHaveBeenCalledWith({ saved: ['priority'], detached: true })
    expect(onSaved).not.toHaveBeenCalled() // 새 항목의 상태를 건드리지 않는다
    expect(h().isPending).toBe(false)
    expect(h().view).toEqual({ priority: 'medium', delegate: true })
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitPriority).toHaveBeenCalledTimes(1)
  })

  it('페이지를 떠날 때(pagehide) flush 한다', async () => {
    await mount()
    await act(async () => { h().set('delegate', true) })
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(commitDelegate).toHaveBeenCalledWith(true)
    expect(commitDelegate).toHaveBeenCalledTimes(1)
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitDelegate).toHaveBeenCalledTimes(1) // 중복 저장 없음
  })

  it('페이지를 떠날 때(beforeunload) flush 한다', async () => {
    await mount()
    await act(async () => { h().set('delegate', true) })
    await act(async () => { window.dispatchEvent(new Event('beforeunload')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(commitDelegate).toHaveBeenCalledWith(true)
  })

  it('분리 flush 의 실패는 console.error 로 남긴다 — 표시할 패널이 없다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    commitPriority.mockResolvedValue({ ok: false, error: '실패했습니다' })
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0])).toContain('실패했습니다')
    spy.mockRestore()
  })

  it('저장 중에 같은 필드를 다시 바꾸면 그 값은 남았다가 다음 사이클에 저장된다', async () => {
    let release!: () => void
    commitPriority.mockImplementationOnce(() => new Promise<Res>(r => { release = () => r({ ok: true }) }))
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await tick(SAVE_DEBOUNCE_MS)
    expect(h().saving).toBe(true)
    await act(async () => { h().set('priority', 'critical') })
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })
    expect(h().saving).toBe(false)
    expect(h().isPending).toBe(true)
    expect(h().view?.priority).toBe('critical')
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitPriority).toHaveBeenCalledTimes(2)
    expect(commitPriority).toHaveBeenLastCalledWith('critical')
  })

  it('flush 시점에 baseline 과 같아진 필드는 건너뛴다 — 재조회가 같은 값을 실어온 경우', async () => {
    await mount()
    await act(async () => { h().set('priority', 'low') })
    await mount('item-1', { priority: 'low', delegate: false }) // 서버가 이미 low 로 바뀌어 있었다
    await tick(SAVE_DEBOUNCE_MS)
    expect(commitPriority).not.toHaveBeenCalled()
    expect(h().isPending).toBe(false)
  })

  it('remainingMs 는 남은 시간을 알려 준다 — 카운트다운 표시용', async () => {
    await mount()
    expect(h().remainingMs).toBeNull()
    await act(async () => { h().set('priority', 'low') })
    expect(h().remainingMs).toBe(SAVE_DEBOUNCE_MS)
    await tick(2000)
    expect(h().remainingMs).toBe(SAVE_DEBOUNCE_MS - 2000)
    await tick(SAVE_DEBOUNCE_MS)
    expect(h().remainingMs).toBeNull()
  })
})
