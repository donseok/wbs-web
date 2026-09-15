// @vitest-environment jsdom
// 레벨 버튼 작업명 헤더 이동 + 마일스톤 개수 숫자 제거(§항목2, 2026-09-15).
// 레벨 버튼 그룹을 툴바([data-wbs-toolbar-rest])에서 작업명 헤더 셀([data-wbs-col="name"])
// 안으로 옮긴다 — data-level-btn·role="group"·expandToLevel 배선은 그대로.
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
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}
// 루트 1개 > 자식 1개 — deepestLevel=2 라 레벨 버튼이 뜬다.
function fixture(): ComputedItem[] {
  const child = item({ id: 'c1', name: '자식', depth: 1 })
  return [item({ id: 'p1', name: '부모', depth: 0, children: [child] })]
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }

describe('WBS 작업명 헤더 — 레벨 버튼 이동', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function render(items: ComputedItem[], extra: Record<string, unknown> = {}) {
    await act(async () => root.render(
      <WbsGanttSheet items={items} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} {...extra} />,
    ))
  }

  it('레벨 버튼이 작업명 헤더 셀 안에 있고, 툴바에는 더 없다', async () => {
    await render(fixture())
    const btn = container.querySelector<HTMLButtonElement>('button[data-level-btn="1"]')
    expect(btn).not.toBeNull()
    const nameHead = container.querySelector('[data-wbs-col="name"][data-wbs-col-kind="header"]')
    expect(nameHead).not.toBeNull()
    expect(nameHead!.contains(btn)).toBe(true)
    expect(container.querySelector('[data-wbs-toolbar-rest] [data-level-btn]')).toBeNull()
  })

  it('role=group·aria-label·expandToLevel 배선은 그대로 동작한다', async () => {
    await render(fixture())
    const group = container.querySelector('[data-wbs-col="name"] [role="group"]')
    expect(group).not.toBeNull()
    expect(group!.getAttribute('aria-label')).toBe('wbs.expandToLevelGroup')
    const btn1 = container.querySelector<HTMLButtonElement>('button[data-level-btn="1"]')!
    expect(rowCount(container)).toBe(2) // p1, c1 모두 펼쳐진 기본 상태
    await act(async () => btn1.click())
    expect(rowCount(container)).toBe(1) // 레벨 1 = 루트만
  })

  it('레벨이 1단뿐이면(자식 없음) 버튼 그룹이 렌더되지 않는다', async () => {
    await render([item({ id: 'solo', children: [] })])
    expect(container.querySelector('[data-wbs-col="name"] [role="group"]')).toBeNull()
  })
})

describe('WBS 마일스톤 토글 — 개수 숫자 제거', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('마일스톤 버튼 라벨에 개수 숫자가 없다("마일스톤" 텍스트·토글은 유지)', async () => {
    // singleDay 마일스톤 판정: plannedStart===plannedEnd && deliverable 존재(키워드 무관, dashboard.ts isMilestoneLeaf)
    const milestone = item({ id: 'm1', name: '킥오프', plannedStart: '2026-07-05', plannedEnd: '2026-07-05', deliverable: '킥오프 보고서' })
    await act(async () => root.render(
      <WbsGanttSheet items={[milestone]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    const toggle = container.querySelector<HTMLButtonElement>('[data-wbs-milestones-toggle]')
    expect(toggle).not.toBeNull() // 마커가 1건 이상이라 버튼은 뜬다
    expect(toggle!.textContent).toBe('wbs.milestones') // 개수 숫자가 더는 붙지 않는다
    expect(toggle!.textContent).not.toMatch(/\d/)
  })
})
