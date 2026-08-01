// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
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

/** 루트(Phase) 한 건 — weight는 1기준 저장값(0.4 = 40%) */
const phase = (id: string, weight: number | null, children: ComputedItem[] = []): ComputedItem => ({
  id,
  parentId: null,
  code: id,
  sortOrder: 0,
  name: `단계 ${id}`,
  biz: null,
  deliverable: null,
  plannedStart: '2026-07-01',
  plannedEnd: '2026-07-10',
  weight,
  actualPct: 0,
  owners: [], isOwnerSplit: false,
  plannedPct: 0,
  rolledActualPct: 0,
  achievement: 0,
  status: 'in_progress',
  children,
  depth: 0,
})

const child = (id: string, weight: number | null): ComputedItem => ({
  ...phase(id, weight),
  parentId: 'p',
})

describe('WbsGanttSheet — 가중치 헤더 합계', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (items: ComputedItem[]) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <WbsGanttSheet
        items={items}
        holidays={[]}
        today="2026-07-03"
        actorView={null}
        projectId="p1"
        readOnly
      />,
    ))
  }

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const sub = () => container.querySelector('[data-wbs-head-sub="weight"]')

  it('1레벨 가중치 합을 % 로 표시한다', async () => {
    await render([phase('a', 0.4), phase('b', 0.6)])
    expect(sub()?.textContent).toBe('(100%)')
  })

  it('100%에서 벗어나면 경고 색으로 표시한다', async () => {
    await render([phase('a', 0.4), phase('b', 0.59)])
    expect(sub()?.textContent).toBe('(99%)')
    expect(sub()?.className).toContain('text-delayed')
  })

  it('합계는 하위 레벨 가중치를 더하지 않는다 — 형제 그룹 기준이므로 루트만 센다', async () => {
    await render([phase('a', 1, [child('a1', 0.5), child('a2', 0.5)])])
    expect(sub()?.textContent).toBe('(100%)')
  })

  it('루트 가중치가 모두 균등(null)이면 합계를 숨긴다', async () => {
    await render([phase('a', null), phase('b', null)])
    expect(sub()).toBeNull()
  })
})
