// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
type Nav = { onPrev: (() => void) | null; onNext: (() => void) | null }
const panel = vi.hoisted(() => ({ last: null as null | { itemId: string; nav?: Nav } }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({
  RowDetailPanel: (p: { item: { id: string }; nav?: Nav }) => { panel.last = { itemId: p.item.id, nav: p.nav }; return null },
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(id: string, sortOrder: number): ComputedItem {
  return {
    id, parentId: null, code: id, sortOrder, name: `작업 ${id}`,
    biz: null, deliverable: null, plannedStart: '2026-07-13', plannedEnd: '2026-07-15', weight: null, actualPct: 100,
    owners: [], isOwnerSplit: false, plannedPct: 100, rolledActualPct: 100, achievement: 100, status: 'done', children: [], depth: 0,
  }
}

/** 상세 패널 위·아래 버튼(2026-09-25) — 표에 보이는 행 순서대로 선택을 옮기고, 끝 행에서는 그쪽 버튼을 끈다. */
describe('WBS 상세 패널 — 이전·다음 항목 이동', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    panel.last = null
    Element.prototype.scrollIntoView = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('첫 행에서 이전은 꺼지고, 다음을 누르면 아래 행으로, 마지막 행에서 다음은 꺼진다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={[item('A', 1), item('B', 2), item('C', 3)]} dependencies={[]} holidays={[]}
        today="2026-07-01" actorView={null} projectId="p1" readOnly />,
    ))
    const nameBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '작업 A')!
    await act(async () => nameBtn.click())
    expect(panel.last?.itemId).toBe('A')
    expect(panel.last?.nav?.onPrev).toBeNull()
    await act(async () => panel.last!.nav!.onNext!())
    expect(panel.last?.itemId).toBe('B')
    await act(async () => panel.last!.nav!.onNext!())
    expect(panel.last?.itemId).toBe('C')
    expect(panel.last?.nav?.onNext).toBeNull()
    await act(async () => panel.last!.nav!.onPrev!())
    expect(panel.last?.itemId).toBe('B')
  })
})
