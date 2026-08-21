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
    const tipOf = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-gantt-bar] [data-gantt-tooltip]`)!
    const phaseTip = tipOf('p1')
    expect(phaseTip.textContent).toContain('26.07.01 ~ 26.07.10') // 날짜가 첫 줄 핵심 정보
    expect(phaseTip.textContent).toContain('status.in_progress')
    expect(phaseTip.textContent).toContain('wbs.colPlannedPct 50.0%')
    expect(phaseTip.textContent).toContain('wbs.colActualPct 37.5%')
    expect(phaseTip.textContent).not.toContain('준비 공정') // 작업명은 행에 이미 보인다 — 제외
    // 커스텀 툴팁 — 평소 투명, 바 hover 시 opacity 로 나타난다(display 변형은 안전망 금지).
    expect(phaseTip.className).toContain('opacity-0')
    expect(phaseTip.className).toContain('group-hover/bar:opacity-100')
    expect(tipOf('a1').textContent).toContain('26.07.01 ~ 26.07.10')
    // 툴팁은 위로 펼쳐져 sticky 헤더(z-40)와 겹칠 수 있다 — hover 된 행을 헤더 위(z-45)로
    // 올려야 화면 상단 행에서도 보인다(스테이징 실측 회귀).
    const row = container.querySelector<HTMLElement>('[data-row-id="p1"]')!
    expect(row.className).toContain('hover:z-[45]')
  })
})
