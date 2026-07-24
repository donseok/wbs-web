// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(),
  updateWeight: vi.fn(),
  addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/components/wbs/RowDetailPanel', () => ({
  RowDetailPanel: () => null,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueWbsCollapse: vi.fn(),
}))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(plannedStart: string, plannedEnd: string): ComputedItem {
  return {
    id: 'a1',
    parentId: null,
    level: 'activity',
    code: '1',
    sortOrder: 0,
    name: '일정 항목',
    biz: null,
    deliverable: null,
    plannedStart,
    plannedEnd,
    weight: null,
    actualPct: 0,
    owners: [],
    plannedPct: 0,
    rolledActualPct: 0,
    achievement: null,
    status: 'not_started',
    children: [],
  }
}

describe('WBS 기준일 초기 스크롤', () => {
  let container: HTMLDivElement
  let root: Root
  let assignedScrollLeft: number[]

  beforeEach(() => {
    assignedScrollLeft = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.hasAttribute('data-wbs-scroll-region') ? 1200 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        if (!this.hasAttribute('data-wbs-scroll-region')) return 0
        return Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.width ?? '0')
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get() {
        return assignedScrollLeft.at(-1) ?? 0
      },
      set(value: number) {
        if (this.hasAttribute('data-wbs-scroll-region')) assignedScrollLeft.push(Number(value))
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollLeft
  })

  it.each([
    ['sheet' as const, 1464],
    ['timeline' as const, 874],
  ])('%s 모드 진입 즉시 기준일을 sticky 열 오른쪽 중앙에 배치한다', async (defaultView, expected) => {
    await act(async () => {
      root.render(
        <WbsGanttSheet
          items={[item('2026-06-01', '2026-08-31')]}
          holidays={[]}
          today="2026-07-15"
          membership={null}
          projectId="p1"
          readOnly
          defaultView={defaultView}
        />,
      )
    })

    expect(assignedScrollLeft).toEqual([expected])
  })

  it('기준일이 프로젝트 일정 밖이어도 축과 첫 화면에 포함한다', async () => {
    await act(async () => {
      root.render(
        <WbsGanttSheet
          items={[item('2026-08-01', '2026-08-10')]}
          holidays={[]}
          today="2026-07-24"
          membership={null}
          projectId="p1"
          readOnly
        />,
      )
    })

    expect(container.textContent).toContain('wbs.today')
    expect(assignedScrollLeft).toEqual([408])
  })
})
