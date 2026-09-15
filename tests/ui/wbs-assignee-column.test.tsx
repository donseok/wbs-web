// @vitest-environment jsdom
// 담당자 컬럼 신설(§항목1, 2026-09-15): "담당"(item_owners, 팀)은 "담당팀"으로 라벨만 바꾸고,
// 개인 담당자(wbs_items.assignee_member_id) 컬럼을 신설해 병존시킨다. 표시명은 저장하지 않고
// WbsGanttSheet 가 이미 받는 members prop(project_members)으로 렌더 시점에 해석한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, ProjectMember } from '@/lib/domain/types'
import { wbsKo } from '@/lib/i18n/dict/wbs'
import { wbsEn } from '@/lib/i18n/dict/wbs.en'

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
function member(over: Partial<ProjectMember>): ProjectMember {
  return { id: 'm1', projectId: 'p1', name: '홍길동', email: null, teamCode: null, role: 'contributor',
    title: null, roleLabel: null, hasAccount: true, createdAt: '2026-01-01T00:00:00Z', ...over }
}

describe('WBS 사전 — 담당팀/담당자 라벨', () => {
  it('담당(owners)은 담당팀으로 개명, 담당자(assignee)는 신설 — ko/en 키 패리티 유지', () => {
    expect(wbsKo['wbs.colOwners']).toBe('담당팀')
    expect(wbsKo['wbs.colAssignee']).toBe('담당자')
    expect(wbsEn['wbs.colOwners']).toBe('Owner team')
    expect(wbsEn['wbs.colAssignee']).toBe('Assignee')
  })
})

describe('WBS 담당자 컬럼', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function render(items: ComputedItem[], members: ProjectMember[] = []) {
    await act(async () => root.render(
      <WbsGanttSheet items={items} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} members={members} />,
    ))
  }

  const header = () => container.querySelector<HTMLElement>('[data-wbs-col="assignee"][data-wbs-col-kind="header"]')
  const bodyCell = (id: string) => container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-wbs-col="assignee"]`)

  it('담당자가 지정된 항목이 하나도 없으면 컬럼 자체가 없다', async () => {
    await render([item({ id: 'a1' }), item({ id: 'a2' })], [member({ id: 'm1' })])
    expect(header()).toBeNull()
    expect(bodyCell('a1')).toBeNull()
  })

  it('담당자가 한 명이라도 있으면 컬럼이 뜨고, 지정된 행은 이름을, 미지정 행은 -를 보여준다', async () => {
    await render(
      [item({ id: 'a1', assigneeMemberId: 'm1' }), item({ id: 'a2' })],
      [member({ id: 'm1', name: '홍길동' })],
    )
    expect(header()).not.toBeNull()
    expect(header()!.textContent).toContain('wbs.colAssignee')
    expect(bodyCell('a1')!.textContent).toBe('홍길동')
    expect(bodyCell('a2')!.textContent).toBe('-')
  })

  it('깊은 자손에만 담당자가 있어도 컬럼이 뜬다(재귀 판정)', async () => {
    const leaf = item({ id: 'c1', assigneeMemberId: 'm1' })
    const mid = item({ id: 'b1', children: [leaf] })
    await render([item({ id: 'a1', children: [mid] })], [member({ id: 'm1' })])
    expect(header()).not.toBeNull()
  })

  it('로스터에 없는 id는 -가 아니라 알 수 없음으로 구분 표시한다(데이터 없음으로 위장 금지)', async () => {
    await render([item({ id: 'a1', assigneeMemberId: 'ghost' })], [member({ id: 'm1' })])
    expect(bodyCell('a1')!.textContent).toBe('wbs.unknownActor')
    expect(bodyCell('a1')!.textContent).not.toBe('-')
  })
})
