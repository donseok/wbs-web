// tests/components/wbs-force-progress-section.test.tsx
// @vitest-environment jsdom
// 사이드바 「강제 진행」 절 — 선행별 상태·버튼·사유 입력·스텁 잔존 목록.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const actions = vi.hoisted(() => ({ setDependencyWaiver: vi.fn(), cancelStubTask: vi.fn() }))
vi.mock('@/app/actions/forceProgress', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ForceProgressSection } from '@/components/wbs/ForceProgressSection'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  actions.setDependencyWaiver.mockResolvedValue({ ok: true, subTaskId: 's1', subTaskCreated: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const base = (id: string, over: Partial<ComputedItem>): ComputedItem => ({
  id, parentId: null, code: id, sortOrder: 1, name: id, biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false, children: [], subTasks: [], depth: 0,
  plannedPct: 0, rolledActualPct: 0, achievement: 0, status: 'not_started', ...over,
} as ComputedItem)
const pred = base('pred', { code: 'TSK-03-01', name: '주문 서비스', externalRef: 'm/TSK-03-01', stage: 'ip', rolledActualPct: 30, hasContract: true })
const succ = base('succ', { externalRef: 'm/TSK-03-02', depends: ['m/TSK-03-01'], dependsWaived: [], stage: 'im' })
const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
const setInput = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
}
const draw = (item: ComputedItem, map = new Map([['m/TSK-03-01', pred]]), editable = true, onSelectItem = vi.fn()) => {
  act(() => root.render(<ForceProgressSection item={item} itemByRef={map} editable={editable} onSelectItem={onSelectItem} />))
  return onSelectItem
}

describe('ForceProgressSection', () => {
  it('미도달 선행에 「강제 진행」, 사유 없이는 확정할 수 없다', async () => {
    draw(succ)
    await act(async () => { (q('[data-waive="m/TSK-03-01"]') as HTMLButtonElement).click() })
    const ok = q('[data-waive-confirm]') as HTMLButtonElement
    expect(ok.textContent).toBe('강제 진행 확정')
    expect(ok.disabled).toBe(true)
    await act(async () => { setInput(q('[data-waive-reason]') as HTMLInputElement, '병목') })
    expect(ok.disabled).toBe(false)
    await act(async () => { ok.click() })
    expect(actions.setDependencyWaiver).toHaveBeenCalledWith('succ', 'm/TSK-03-01', true, '병목')
  })
  it('면제된 간선은 「면제 해제」, 스텁 잔존 목록이 하위로 링크된다', async () => {
    const sub = base('s1', { stubFor: 'm/TSK-03-01', externalRef: 'm/TSK-03-02.stub.TSK-03-01', stage: 'ip' })
    const onSelect = draw({ ...succ, dependsWaived: ['m/TSK-03-01'], subTasks: [sub] })
    expect(q('[data-unwaive="m/TSK-03-01"]')!.textContent).toBe('면제 해제')
    const link = q('[data-stub-link="s1"]') as HTMLButtonElement
    expect(link.textContent).toBe('스텁 잔존: TSK-03-01 대체')
    await act(async () => { link.click() })
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
  it('계약 없는 선행은 버튼을 끄고 「선행 계약 없음」', () => {
    draw(succ, new Map([['m/TSK-03-01', { ...pred, hasContract: false }]]))
    expect((q('[data-waive="m/TSK-03-01"]') as HTMLButtonElement).disabled).toBe(true)
    expect(q('[data-waive-block]')!.textContent).toBe('선행 계약 없음')
  })
  it('편집 권한이 없으면 버튼이 없다', () => {
    draw(succ, undefined, false)
    expect(q('[data-waive]')).toBeNull()
  })
})
