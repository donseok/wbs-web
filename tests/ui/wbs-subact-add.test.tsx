// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, OwnerKind, TeamCode } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const addSubAct = vi.fn(async () => ({ ok: true, id: 'new' }))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn(async () => []),
  updateWbsFields: vi.fn(async () => ({ ok: true })),
  addWbsItem: vi.fn(async () => ({ ok: true })),
  addSubAct: (...a: unknown[]) => addSubAct(...(a as [])),
  deleteWbsItem: vi.fn(async () => ({ ok: true })),
  moveWbsItem: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn(async () => []),
  recordAttachment: vi.fn(async () => ({ ok: true })),
  removeAttachment: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({}) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x', parentId: null, level: 'activity', code: '1', sortOrder: 0, name: '항목',
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10',
    weight: null, actualPct: 0, owners: [], plannedPct: 0, rolledActualPct: 0,
    achievement: null, status: 'not_started', children: [], ...over,
  }
}
const child = (team: TeamCode, kind: OwnerKind = 'primary'): ComputedItem =>
  item({ id: `s-${team}`, parentId: 'a1', name: `A (${team})`, owners: [{ team, kind }] })

describe('RowDetailPanel — SUB-ACT 추가 어포던스', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    addSubAct.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(node: ComputedItem, opts: { editable?: boolean; subAct?: boolean } = {}) {
    await act(async () =>
      root.render(
        <RowDetailPanel item={node} onClose={() => {}} projectId="p1" editable={opts.editable ?? true} subAct={opts.subAct ?? false} />,
      ),
    )
  }
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')]
  const byText = (re: RegExp) => buttons().filter(b => re.test(b.textContent ?? ''))
  const teamOptions = () => buttons().filter(b => /^(PMO|ERP|MES|가공|MDM)$/.test((b.textContent ?? '').trim()))

  it('ACT(자식 있는 activity)에는 SUB-ACT 추가 버튼이 보인다', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [child('가공'), child('ERP')] }))
    expect(byText(/wbs\.addSubAct/)).toHaveLength(1)
  })

  it('SUB-ACT(subAct=true)에는 버튼이 없다 — 1단계 제한', async () => {
    await mount(item({ id: 's1', parentId: 'a1', owners: [{ team: '가공', kind: 'primary' }] }), { subAct: true })
    expect(byText(/wbs\.addSubAct/)).toHaveLength(0)
  })

  it('비편집(PMO 아님)이면 구조 편집 섹션 자체가 없어 버튼이 없다', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [child('가공')] }), { editable: false })
    expect(byText(/wbs\.addSubAct/)).toHaveLength(0)
  })

  it('폼을 열면 이미 쓰인 팀(가공·ERP)을 제외한 팀만 선택지로 뜬다', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [child('가공'), child('ERP')] }))
    await act(async () => byText(/wbs\.addSubAct/)[0].click())
    const teams = teamOptions().map(b => (b.textContent ?? '').trim())
    expect(teams).toEqual(['PMO', 'MES', 'MDM'])
  })

  it('실적%가 있는 리프 ACT에서 폼을 열면 롤업 전환 경고가 뜬다', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [], actualPct: 50, rolledActualPct: 50 }))
    await act(async () => byText(/wbs\.addSubAct/)[0].click())
    expect(container.textContent).toContain('wbs.subActLeafWarn')
    expect(teamOptions().map(b => (b.textContent ?? '').trim())).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
  })

  it('팀 선택 후 추가하면 addSubAct(itemId, team, kind=primary)로 호출된다', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [child('가공'), child('ERP')] }))
    await act(async () => byText(/wbs\.addSubAct/)[0].click())
    await act(async () => teamOptions().find(b => (b.textContent ?? '').trim() === 'PMO')!.click())
    await act(async () => byText(/^common\.add$/)[0].click())
    expect(addSubAct).toHaveBeenCalledWith('a1', 'PMO', 'primary')
  })

  it('남은 팀이 하나뿐이면 폼을 열 때 자동 선택되어 팀 클릭 없이 바로 추가된다', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [child('PMO'), child('ERP'), child('MES'), child('MDM')] }))
    await act(async () => byText(/wbs\.addSubAct/)[0].click())
    await act(async () => byText(/^common\.add$/)[0].click()) // 팀 미선택 상태에서 바로 추가
    expect(addSubAct).toHaveBeenCalledWith('a1', '가공', 'primary')
  })

  it('선택지가 2개 이상이면 팀 미선택 시 추가 버튼이 비활성', async () => {
    await mount(item({ id: 'a1', name: 'A', children: [child('가공'), child('ERP')] }))
    await act(async () => byText(/wbs\.addSubAct/)[0].click())
    expect(byText(/^common\.add$/)[0].disabled).toBe(true)
  })
})
