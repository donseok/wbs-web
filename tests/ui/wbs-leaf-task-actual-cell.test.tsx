// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, Membership } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateActual = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: (...a: unknown[]) => updateActual(...(a as [])),
  updateWeight: vi.fn(async () => ({ ok: true })),
  addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

const pmo: Membership = { role: 'pmo_admin', teamCode: 'PMO', teamId: 'tp' }
const dtEditor: Membership = { role: 'team_editor', teamCode: '가공', teamId: 'td' }

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x', parentId: null, level: 'activity', code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], ...over,
  }
}

/* 실데이터 모양: Phase '1. 준비' 아래에
 *   - '1-3. 프로젝트 착수 보고회' = 자식 없는 Task(PMO 주관) ← 지금까지 실적 입력 불가였던 항목
 *   - '1-1. 작업' = activity 자식을 가진 Task(롤업 부모) */
function fixture(): ComputedItem[] {
  const loneTask = item({
    id: 't-lone', level: 'task', code: '1-3', name: '1-3. 프로젝트 착수 보고회',
    owners: [{ team: 'PMO', kind: 'primary' }], sortOrder: 0,
  })
  const rollupTask = item({
    id: 't-parent', level: 'task', code: '1-1', name: '1-1. 작업', sortOrder: 1,
    children: [item({ id: 'a1', parentId: 't-parent', name: '활동', owners: [{ team: '가공', kind: 'primary' }] })],
  })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [loneTask, rollupTask] })]
}

/** 실적% 셀은 편집 가능할 때만 role=button + title=wbs.editActualTitle 을 갖는다. */
function actualCells(c: HTMLElement) {
  return [...c.querySelectorAll<HTMLElement>('[title="wbs.editActualTitle"]')]
}
function rowNames(c: HTMLElement) {
  return [...c.querySelectorAll<HTMLElement>('.group.relative.z-10')].map(
    r => r.querySelector('button[type="button"]')?.textContent ?? '',
  )
}

describe('WbsGanttSheet — 단독 Task 실적% 입력', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    updateActual.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const mount = (membership: Membership | null, readOnly = false) =>
    act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" membership={membership} projectId="p1" readOnly={readOnly} />,
    ))

  it('PMO에게는 단독 Task 의 실적% 셀만 편집 가능하고, 롤업 Task·Phase 는 아니다', async () => {
    await mount(pmo)
    // 렌더된 행: phase, 단독 task, 롤업 task, 그 activity 자식
    expect(rowNames(container)).toEqual(['1. 준비', '1-3. 프로젝트 착수 보고회', '1-1. 작업', '활동'])
    // 편집 가능한 실적 셀 = 단독 Task + 말단 activity 2개 (phase·롤업 task 는 제외)
    expect(actualCells(container)).toHaveLength(2)
    const rows = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')]
    expect(rows[1].querySelector('[title="wbs.editActualTitle"]')).not.toBeNull() // 단독 task
    expect(rows[0].querySelector('[title="wbs.editActualTitle"]')).toBeNull()     // phase
    expect(rows[2].querySelector('[title="wbs.editActualTitle"]')).toBeNull()     // 롤업 task
  })

  it('단독 Task 실적% 셀을 클릭하면 입력이 열리고, 저장하면 updateActual 이 호출된다', async () => {
    await mount(pmo)
    const cell = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')][1]
      .querySelector<HTMLElement>('[title="wbs.editActualTitle"]')!
    expect(cell.getAttribute('role')).toBe('button')

    await act(async () => cell.click())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="wbs.ariaEditActual"]')
    expect(input).not.toBeNull()

    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, '60')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    // 세 번째 인자는 낙관적 잠금 기준값(편집 시작 시점의 실적%).
    expect(updateActual).toHaveBeenCalledWith('t-lone', 60, 0)
  })

  it('담당이 아닌 팀 편집자에게는 단독 Task 실적% 셀이 열리지 않는다', async () => {
    await mount(dtEditor) // 가공 팀 — 단독 Task 는 PMO 주관
    const rows = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')]
    expect(rows[1].querySelector('[title="wbs.editActualTitle"]')).toBeNull() // 단독 task(PMO 담당)
    expect(rows[3].querySelector('[title="wbs.editActualTitle"]')).not.toBeNull() // 가공 담당 activity
  })

  it('readOnly 면 PMO 라도 열리지 않는다', async () => {
    await mount(pmo, true)
    expect(actualCells(container)).toHaveLength(0)
  })
})
