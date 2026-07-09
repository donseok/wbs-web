// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const addWbsItem = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn(async () => []),
  updateWbsFields: vi.fn(async () => ({ ok: true })),
  addWbsItem: (...a: unknown[]) => addWbsItem(...(a as [])),
  addSubAct: vi.fn(async () => ({ ok: true })),
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
    id: 'x', parentId: null, level: 'task', code: '1-3', sortOrder: 0, name: '1-3. 프로젝트 착수 보고회',
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-01',
    weight: null, actualPct: 0, owners: [], plannedPct: 0, rolledActualPct: 0,
    achievement: null, status: 'not_started', children: [], ...over,
  }
}

/* 단독 Task 도 실적%를 담을 수 있게 되면서, 거기에 하위를 붙이면 그 값이 롤업에 가려진다.
 * 경고 없이 사라지면 안 된다(서버는 addWbsItem 에서 실제로 null 로 지운다). */
describe('RowDetailPanel — 하위 추가 시 실적% 폐기 경고', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    addWbsItem.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(node: ComputedItem) {
    await act(async () =>
      root.render(<RowDetailPanel item={node} onClose={() => {}} projectId="p1" editable />),
    )
  }
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button')]
  const byText = (re: RegExp) => buttons().filter(b => re.test(b.textContent ?? ''))
  const openAddChild = async () => act(async () => byText(/wbs\.addChild/)[0].click())

  it('실적%가 있는 단독 Task 에서 하위 추가 폼을 열면 경고가 뜬다', async () => {
    await mount(item({ actualPct: 70, rolledActualPct: 70 }))
    await openAddChild()
    expect(container.textContent).toContain('wbs.addChildLeafWarn')
  })

  it('실적%가 0이면 잃을 게 없으므로 경고가 없다', async () => {
    await mount(item({ actualPct: 0, rolledActualPct: 0 }))
    await openAddChild()
    expect(container.textContent).not.toContain('wbs.addChildLeafWarn')
  })

  it('이미 자식이 있으면(롤업 부모) 경고가 없다 — 둘째 자식 추가는 잃을 값이 없다', async () => {
    await mount(item({ actualPct: 70, children: [item({ id: 'c', level: 'activity' })] }))
    await openAddChild()
    expect(container.textContent).not.toContain('wbs.addChildLeafWarn')
  })

  it('경고와 무관하게 하위 추가는 activity 레벨로 진행된다', async () => {
    await mount(item({ id: 't1', actualPct: 70 }))
    await openAddChild()
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!
        .set!.call(input, '킥오프 준비')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => byText(/^common\.add$/)[0].click())
    expect(addWbsItem).toHaveBeenCalledWith('p1', 't1', 'activity', '킥오프 준비')
  })
})
