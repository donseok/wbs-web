// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
const queueWbsCollapse = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: (...a: unknown[]) => queueWbsCollapse(...(a as [])) }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, level: 'activity', code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], ...over }
}
function fixture(): ComputedItem[] {
  const subs = [
    item({ id: 's1', parentId: 'a1', name: 'CBO (가공 주관)', owners: [{ team: '가공', kind: 'primary' }] }),
    item({ id: 's2', parentId: 'a1', name: 'CBO (ERP 주관)', owners: [{ team: 'ERP', kind: 'primary' }] }),
  ]
  const multi = item({ id: 'a1', name: 'CBO', owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'primary' }], children: subs })
  const task = item({ id: 't1', level: 'task', name: '1-1. 작업', children: [multi] })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [task] })]
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }

describe('WBS initialCollapsed', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueWbsCollapse.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('initialCollapsed=[] 이면 기본 접힘을 무시하고 복수담당 부모가 펼쳐진 채 렌더된다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    // 기본값이면 phase+task+act=3행(sub 숨김). initialCollapsed=[] 이면 sub 2개까지 5행.
    expect(rowCount(container)).toBe(5)
  })

  it('initialCollapsed 미지정이면 기존 기본값(복수담당 부모 접힘)을 유지한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={null} projectId="p1" readOnly />,
    ))
    expect(rowCount(container)).toBe(3)
  })

  it('마운트 시(StrictMode 이중 실행 포함) 저장을 호출하지 않는다', async () => {
    // React StrictMode는 개발 모드에서 마운트 이펙트를 setup→cleanup→setup 두 번 실행한다.
    // 참조 비교 가드는 두 번째 setup에서도 collapsed 가 초기 참조 그대로이므로 저장을 건너뛴다.
    await act(async () => root.render(
      <StrictMode>
        <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={null} projectId="p1" readOnly />
      </StrictMode>,
    ))
    expect(queueWbsCollapse).not.toHaveBeenCalled()
  })

  it('사용자가 접힘 토글을 누르면 저장을 정확히 1회 호출한다', async () => {
    await act(async () => root.render(
      <StrictMode>
        <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={null} projectId="p1" readOnly />
      </StrictMode>,
    ))
    expect(queueWbsCollapse).not.toHaveBeenCalled()

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="wbs.expand"]')
    expect(toggle).not.toBeNull()
    await act(async () => toggle!.click())

    expect(queueWbsCollapse).toHaveBeenCalledTimes(1)
    expect(queueWbsCollapse).toHaveBeenCalledWith('p1', expect.any(Array))
  })
})
