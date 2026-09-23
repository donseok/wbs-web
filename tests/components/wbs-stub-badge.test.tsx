// tests/components/wbs-stub-badge.test.tsx
// @vitest-environment jsdom
// 스텁 잔존 배지(스펙 F13) — 문구·툴팁·링크가 같은 함수에서 나온다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StubBadge } from '@/components/wbs/StubBadge'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const s = (id: string, stubFor: string) => ({ id, stubFor, externalRef: null, stage: 'ip' })
const badge = () => host.querySelector('[data-stub-badge]') as HTMLButtonElement | null

describe('StubBadge', () => {
  it('0건이면 그리지 않는다', () => {
    act(() => root.render(<StubBadge stubs={[]} />))
    expect(badge()).toBeNull()
  })
  it('1건: 「스텁 잔존」, 툴팁에 대체 선행, 누르면 그 하위로', () => {
    const onOpen = vi.fn()
    act(() => root.render(<StubBadge stubs={[s('sub1', 'mdm/TSK-03-01')]} onOpen={onOpen} />))
    expect(badge()!.textContent).toBe('스텁 잔존')
    expect(badge()!.getAttribute('title')).toBe('스텁 잔존: TSK-03-01 대체')
    act(() => badge()!.click())
    expect(onOpen).toHaveBeenCalledWith('sub1')
  })
  it('2건: 「스텁 잔존 2」, 툴팁은 한 줄씩', () => {
    act(() => root.render(<StubBadge stubs={[s('a', 'm/TSK-01'), s('b', 'm/TSK-02')]} onOpen={() => {}} />))
    expect(badge()!.textContent).toBe('스텁 잔존 2')
    expect(badge()!.getAttribute('title')).toBe('스텁 잔존: TSK-01 대체\n스텁 잔존: TSK-02 대체')
  })
})
