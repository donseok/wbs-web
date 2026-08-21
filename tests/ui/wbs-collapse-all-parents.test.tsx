// @vitest-environment jsdom
// 접기 전면 허용(§WBS 접기 확장): 종전에는 sub-act 부모(splitParentIds)만 토글할 수 있었다.
// 이제 자식이 있는 모든 노드(phase/task 포함)가 접기 대상이다 — 보통의 프로젝트 관리 도구
// (MS Project·ag-grid·TanStack) 동작. flatten 은 원래 범용이었으므로 이 테스트는
// "UI 어포던스(토글 버튼)와 그 결과(자손 숨김·배지)"를 검증한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}
// phase(p1) > task(t1) > act(a1, a2-leaf) — sub-act 없는 순수 3단 트리.
// 종전 구현에서는 splitParentIds 가 빈 집합이라 어떤 행에도 토글 버튼이 없었다.
function fixture(): ComputedItem[] {
  const a1 = item({ id: 'a1', name: '설계', depth: 2 })
  const a2 = item({ id: 'a2', name: '구현', depth: 2 })
  const t1 = item({ id: 't1', name: '1-1. 작업', depth: 1, children: [a1, a2] })
  return [item({ id: 'p1', name: '1. 준비', depth: 0, children: [t1] })]
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }
function toggleOf(c: HTMLElement, id: string) {
  return c.querySelector<HTMLButtonElement>(`[data-row-id="${id}"] button[aria-expanded]`)
}

describe('WBS 접기 — 자식이 있는 모든 노드', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function render(items: ComputedItem[]) {
    await act(async () => root.render(
      <WbsGanttSheet items={items} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
  }

  it('sub-act 가 없어도 phase·task 등 자식이 있는 모든 행에 토글 버튼이 있다', async () => {
    await render(fixture())
    expect(toggleOf(container, 'p1')).not.toBeNull()
    expect(toggleOf(container, 't1')).not.toBeNull()
  })

  it('leaf 행에는 토글 버튼이 없다', async () => {
    await render(fixture())
    expect(toggleOf(container, 'a1')).toBeNull()
    expect(toggleOf(container, 'a2')).toBeNull()
  })

  it('상위(phase)를 접으면 하위 전체(task·act)가 숨는다', async () => {
    await render(fixture())
    expect(rowCount(container)).toBe(4)
    await act(async () => toggleOf(container, 'p1')!.click())
    expect(rowCount(container)).toBe(1)
    expect(container.querySelector('[data-row-id="t1"]')).toBeNull()
    expect(container.querySelector('[data-row-id="a1"]')).toBeNull()
  })

  it('중간(task)을 접으면 그 하위만 숨고 phase 는 남는다', async () => {
    await render(fixture())
    await act(async () => toggleOf(container, 't1')!.click())
    expect(rowCount(container)).toBe(2)
    expect(container.querySelector('[data-row-id="p1"]')).not.toBeNull()
    expect(container.querySelector('[data-row-id="t1"]')).not.toBeNull()
  })

  it('접었다 다시 펼치면 하위가 원래대로 돌아온다', async () => {
    await render(fixture())
    await act(async () => toggleOf(container, 'p1')!.click())
    await act(async () => toggleOf(container, 'p1')!.click())
    expect(rowCount(container)).toBe(4)
  })

  it('접힌 행은 숨은 자손 수 배지를 보여준다(자손 전체 기준)', async () => {
    await render(fixture())
    await act(async () => toggleOf(container, 'p1')!.click())
    const badge = container.querySelector('[data-row-id="p1"] [data-collapsed-count]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('3') // t1 + a1 + a2
  })

  it('펼친 행에는 자손 수 배지가 없다', async () => {
    await render(fixture())
    const badge = container.querySelector('[data-row-id="p1"] [data-collapsed-count]')
    expect(badge).toBeNull()
  })

  it('깊이 d 행의 이름 셀에 조상 깊이만큼 들여쓰기 가이드 선이 그려진다', async () => {
    await render(fixture())
    expect(container.querySelectorAll('[data-row-id="p1"] [data-indent-guide]').length).toBe(0)
    expect(container.querySelectorAll('[data-row-id="t1"] [data-indent-guide]').length).toBe(1)
    expect(container.querySelectorAll('[data-row-id="a1"] [data-indent-guide]').length).toBe(2)
  })

  it('leaf 도 토글 버튼과 같은 폭의 자리를 차지해 이름 시작 위치가 정렬된다', async () => {
    await render(fixture())
    const btn = toggleOf(container, 't1')!
    const spacer = container.querySelector<HTMLElement>('[data-row-id="a1"] [data-toggle-spacer]')
    expect(spacer).not.toBeNull()
    expect(spacer!.className).toContain('w-6')
    expect(btn.className).toContain('w-6')
  })
})
