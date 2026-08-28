// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(id: string, start: string, end: string, sortOrder: number): ComputedItem {
  return {
    id, parentId: null, code: id, sortOrder, name: `작업 ${id}`,
    biz: null, deliverable: null, plannedStart: start, plannedEnd: end, weight: null, actualPct: 100,
    owners: [], isOwnerSplit: false, plannedPct: 100, rolledActualPct: 100, achievement: 100, status: 'done', children: [], depth: 0,
  }
}

const items = [
  item('A', '2026-07-13', '2026-07-15', 1),
  item('B', '2026-07-16', '2026-07-17', 2),
  item('C', '2026-07-20', '2026-07-21', 3),
]
const dependencies: TaskDependency[] = [
  { id: 'd1', projectId: 'p1', predecessorId: 'A', successorId: 'B', type: 'FS', lagDays: 0, origin: 'manual' },
  { id: 'd2', projectId: 'p1', predecessorId: 'B', successorId: 'C', type: 'FS', lagDays: 0, origin: 'manual' },
]

describe('WBS 간트 작업 의존성 — 바 hover 로만 연결선을 그린다', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render() {
    await act(async () => root.render(
      <WbsGanttSheet
        items={items}
        dependencies={dependencies}
        holidays={[]}
        today="2026-07-01"
        actorView={null}
        projectId="p1"
        readOnly
      />,
    ))
  }

  /** 간트 셀 안의 바 바깥 div — hover 방아쇠가 달린 요소. */
  function barOf(index: number): HTMLElement {
    const cells = container.querySelectorAll<HTMLElement>('[data-wbs-col="gantt"]')
    const bar = cells[index]?.firstElementChild as HTMLElement | null
    expect(bar).toBeTruthy()
    return bar!
  }

  function hover(el: HTMLElement, type: 'mouseover' | 'mouseout') {
    // React 는 mouseenter/leave 를 mouseover/out 위임으로 처리한다 — jsdom 에서는 이쪽을 쏴야 한다.
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body }))
  }

  it('아무 데도 올리지 않으면 연결선을 그리지 않는다 — 종전 상시 표시가 난잡했다', async () => {
    await render()
    expect(container.querySelector('svg.z-20')).toBeNull()
  })

  it('툴바에 의존성 버튼도, 크리티컬·지연 요약 칩도 남기지 않는다', async () => {
    await render()
    const toolbar = container.querySelector('[data-wbs-toolbar]')
    expect(toolbar).toBeTruthy()
    expect(toolbar!.textContent).not.toContain('wbs.dependencies')
    expect(toolbar!.textContent).not.toContain('wbs.criticalShort')
    expect(toolbar!.textContent).not.toContain('wbs.businessDaysUnit')
  })

  it('바에 올리면 그 작업에 걸린 선행·후행 선만 그린다', async () => {
    await render()
    await act(async () => { hover(barOf(1), 'mouseover') }) // B — 선행 A, 후행 C 둘 다 걸린다

    expect(container.querySelectorAll('svg.z-20 path[marker-end]').length).toBe(2)
  })

  it('선행만 걸린 작업에는 그 한 줄만 그린다', async () => {
    await render()
    await act(async () => { hover(barOf(2), 'mouseover') }) // C — 선행 B 하나뿐

    expect(container.querySelectorAll('svg.z-20 path[marker-end]').length).toBe(1)
  })

  it('바를 벗어나면 선이 사라진다', async () => {
    await render()
    await act(async () => { hover(barOf(1), 'mouseover') })
    expect(container.querySelector('svg.z-20')).not.toBeNull()

    await act(async () => { hover(barOf(1), 'mouseout') })
    expect(container.querySelector('svg.z-20')).toBeNull()
  })
})
