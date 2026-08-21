// @vitest-environment jsdom
// 간트 진행 바 hover 툴팁(2026-08-21 피드백) — 바에 올리면 작업명·상태·기간·계획%·실적%가
// title 로 나온다. 셀 폭이 좁아 잘리는 정보를 그래프 위에서 바로 확인하기 위함.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 37.5,
    owners: [], isOwnerSplit: false, plannedPct: 50, rolledActualPct: 37.5, achievement: null, status: 'in_progress', children: [], depth: 0, ...over }
}

describe('간트 진행 바 툴팁', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('phase 바와 하위 바 모두 기간·상태·계획%·실적%를 title 로 담는다(작업명 제외 — 날짜가 핵심)', async () => {
    const leaf = item({ id: 'a1', name: '설계 작업', depth: 1 })
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1', name: '준비 공정', depth: 0, children: [leaf] })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    const barOf = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-gantt-bar]`)!
    const phaseTitle = barOf('p1').title
    expect(phaseTitle).toContain('26.07.01 ~ 26.07.10') // 날짜가 첫 줄 핵심 정보
    expect(phaseTitle).toContain('status.in_progress')
    expect(phaseTitle).toContain('wbs.colPlannedPct 50.0%')
    expect(phaseTitle).toContain('wbs.colActualPct 37.5%')
    expect(phaseTitle).not.toContain('준비 공정') // 작업명은 행에 이미 보인다 — 제외
    expect(barOf('a1').title).toContain('26.07.01 ~ 26.07.10')
  })
})
