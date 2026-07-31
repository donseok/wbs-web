// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))

import { ProgressPopover } from '@/components/kanban/ProgressPopover'
import { KanbanCard } from '@/components/kanban/KanbanCard'
import type { ComputedItem } from '@/lib/domain/types'

describe('ProgressPopover', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('프리셋 버튼을 누르면 해당 %로 onSubmit 된다', async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(
      <ProgressPopover open title="t" initial={30} onSubmit={onSubmit} onClose={() => {}} />,
    ))
    const btn = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '50%')!
    await act(async () => btn.click())
    expect(onSubmit).toHaveBeenCalledWith(50)
  })

  it('직접입력이 범위를 초과하면 99로 클램프되어 onSubmit 된다', async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(
      <ProgressPopover open title="t" initial={30} onSubmit={onSubmit} onClose={() => {}} />,
    ))
    const input = [...document.body.querySelectorAll('input')].find(
      i => i.getAttribute('placeholder') === 'kanban.progressCustom',
    ) as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!
        .set!.call(input, '150')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const apply = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'kanban.progressApply')!
    await act(async () => apply.click())
    expect(onSubmit).toHaveBeenCalledWith(99)
  })
})

function leaf(over: Partial<ComputedItem> = {}): ComputedItem {
  return {
    id: 'L', parentId: null, level: 'activity', code: '1-1', sortOrder: 0, name: '리프작업',
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-30',
    weight: null, actualPct: 40, owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: false,
    plannedPct: 0, rolledActualPct: 40, achievement: null, status: 'in_progress', children: [], ...over,
  }
}

describe('KanbanCard — 상호작용', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('본문 클릭 시 onOpen(WBS 딥링크)이 불린다', async () => {
    const onOpen = vi.fn()
    await act(async () => root.render(
      <KanbanCard card={leaf()} bucket="in_progress" editable onOpen={onOpen} />,
    ))
    const body = container.querySelector('[data-card-body]') as HTMLElement
    await act(async () => body.click())
    expect(onOpen).toHaveBeenCalled()
  })

  it('진행중 편집 카드는 +/− 스텝퍼로 onStep(±10)이 불린다(본문 클릭 전파 안 됨)', async () => {
    const onStep = vi.fn(); const onOpen = vi.fn()
    await act(async () => root.render(
      <KanbanCard card={leaf()} bucket="in_progress" editable onStep={onStep} onOpen={onOpen} />,
    ))
    const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
    await act(async () => inc.click())
    expect(onStep).toHaveBeenCalledWith(10)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('지연 신호가 배지로 표시된다', async () => {
    await act(async () => root.render(
      <KanbanCard card={leaf({ status: 'delayed' })} bucket="in_progress" due={{ kind: 'overdue', days: 5 }} />,
    ))
    expect(container.textContent).toContain('kanban.overduePrefix')
  })
})
