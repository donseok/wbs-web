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
    // 툴팁은 행 내부가 아니라 시트가 그리는 fixed 단일 요소다 — 행/헤더/오버레이 z 경쟁 회피
    // (행을 올리는 방식은 마일스톤 오버레이를 가리는 부작용이 있었다, 2026-08-21 실측 회귀).
    const barOf = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-gantt-bar]`)!
    const hover = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    const unhover = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    const tip = () => container.querySelector<HTMLElement>('[data-gantt-tooltip]')

    expect(tip()).toBeNull() // 평소엔 없음

    await act(async () => hover(barOf('p1')))
    const phaseTip = tip()!
    expect(phaseTip).not.toBeNull()
    expect(phaseTip.className).toContain('fixed')
    expect(phaseTip.textContent).toContain('26.07.01 ~ 26.07.10') // 날짜가 첫 줄 핵심 정보
    expect(phaseTip.textContent).toContain('status.in_progress')
    expect(phaseTip.textContent).toContain('wbs.colPlannedPct 50.0%')
    expect(phaseTip.textContent).toContain('wbs.colActualPct 37.5%')
    expect(phaseTip.textContent).not.toContain('준비 공정') // 작업명은 행에 이미 보인다 — 제외

    await act(async () => unhover(barOf('p1')))
    expect(tip()).toBeNull()

    await act(async () => hover(barOf('a1')))
    expect(tip()!.textContent).toContain('26.07.01 ~ 26.07.10')
    // 행 z 올리기 방식의 회귀 방지 — 오버레이를 가리는 원인이었다.
    expect(container.querySelector('[data-row-id="p1"]')!.className).not.toContain('hover:z-')
  })
})
