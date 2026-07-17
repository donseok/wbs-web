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

function item(id: string, start: string, end: string): ComputedItem {
  return {
    id, parentId: null, level: 'activity', code: id, sortOrder: id === 'A' ? 1 : 2, name: `작업 ${id}`,
    biz: null, deliverable: null, plannedStart: start, plannedEnd: end, weight: null, actualPct: 100,
    owners: [], plannedPct: 100, rolledActualPct: 100, achievement: 100, status: 'done', children: [],
  }
}

const dependencies: TaskDependency[] = [{
  id: 'd1', projectId: 'p1', predecessorId: 'A', successorId: 'B', type: 'FS', lagDays: 0,
}]

describe('WBS 간트 작업 의존성', () => {
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

  it('FS 연결선과 크리티컬 패스를 기본 표시하고 토글로 숨긴다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet
        items={[item('A', '2026-07-13', '2026-07-15'), item('B', '2026-07-16', '2026-07-17')]}
        dependencies={dependencies}
        holidays={[]}
        today="2026-07-01"
        membership={null}
        projectId="p1"
        readOnly
      />,
    ))

    const toggle = container.querySelector<HTMLButtonElement>('button[title="wbs.toggleDependenciesTitle"]')
    expect(toggle?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('svg.z-20 path[marker-end]')).not.toBeNull()
    expect(container.querySelectorAll('.text-critical').length).toBeGreaterThanOrEqual(2)

    await act(async () => toggle!.click())
    expect(toggle?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('svg.z-20')).toBeNull()
  })
})
