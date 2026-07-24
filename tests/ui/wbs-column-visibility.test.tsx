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

const HIDEABLE_COLS = ['owners', 'status', 'deliverable', 'pstart', 'pend', 'weight', 'pplan']

const item: ComputedItem = {
  id: 'a1',
  parentId: null,
  level: 'activity',
  code: '1',
  sortOrder: 0,
  name: '일정 항목',
  biz: null,
  deliverable: '업무분장표',
  plannedStart: '2026-07-01',
  plannedEnd: '2026-07-10',
  weight: 1,
  actualPct: 52,
  owners: [{ team: 'PMO', kind: 'primary' }],
  plannedPct: 60,
  rolledActualPct: 52,
  achievement: 87,
  status: 'in_progress',
  children: [],
}

describe('WbsGanttSheet — 담당~계획% 열 숨기기', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <WbsGanttSheet
        items={[item]}
        holidays={[]}
        today="2026-07-03"
        membership={null}
        projectId="p1"
        readOnly
      />,
    ))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const nodesFor = (key: string) =>
    container.querySelectorAll(`[data-wbs-col="${key}"]`)

  const toggle = () =>
    container.querySelector<HTMLButtonElement>('[data-wbs-columns-toggle]')!

  const sheet = () =>
    container.querySelector<HTMLElement>('[data-wbs-gantt-sheet]')!

  it('기본값은 펼침이며 담당부터 계획%까지 헤더와 셀을 모두 표시한다', () => {
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(toggle().textContent).toContain('wbs.hidePlanningColumns')
    HIDEABLE_COLS.forEach(key => expect(nodesFor(key)).toHaveLength(2))
    expect(sheet().style.getPropertyValue('--wbs-left-w')).toBe('1198px')
  })

  it('숨기기를 누르면 지정한 7개 열만 감추고 경계 열과 간트 시작 위치를 당긴다', async () => {
    await act(async () => toggle().click())

    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(toggle().textContent).toContain('wbs.showPlanningColumns')
    HIDEABLE_COLS.forEach(key => expect(nodesFor(key)).toHaveLength(0))
    ;['name', 'pactual', 'achieve'].forEach(key => expect(nodesFor(key)).toHaveLength(2))
    expect(sheet().style.getPropertyValue('--wbs-left-w')).toBe('552px')
  })

  it('펼치기를 누르면 숨긴 열과 원래 폭을 다시 복원한다', async () => {
    await act(async () => toggle().click())
    await act(async () => toggle().click())

    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(toggle().textContent).toContain('wbs.hidePlanningColumns')
    HIDEABLE_COLS.forEach(key => expect(nodesFor(key)).toHaveLength(2))
    expect(sheet().style.getPropertyValue('--wbs-left-w')).toBe('1198px')
  })
})
