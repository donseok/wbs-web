// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import { t as realT } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]),
  updateWbsFields: vi.fn(), updateDeliverable: vi.fn(), addWbsItem: vi.fn(),
  addSubAct: vi.fn(), deleteWbsItem: vi.fn(), moveWbsItem: vi.fn(),
  addTaskDependency: vi.fn(), removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue([]), recordAttachment: vi.fn(), removeAttachment: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => realT('ko', k as Parameters<typeof realT>[1]) }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => [] }))
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

function computedItem(over: Partial<ComputedItem> = {}): ComputedItem {
  return {
    id: 'item-1', parentId: null, code: 'A-1', sortOrder: 1, name: '대상 작업',
    biz: null, deliverable: null, plannedStart: '2026-08-31', plannedEnd: '2026-09-02',
    weight: null, actualPct: 100, owners: [], isOwnerSplit: false,
    plannedPct: 100, rolledActualPct: 100, achievement: 100, status: 'done',
    children: [], depth: 0,
    ...over,
  }
}

describe('RowDetailPanel — 개요는 가로 2열', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(item = computedItem()) {
    await act(async () => {
      root.render(<RowDetailPanel item={item} allItems={[item]} dependencies={[]} projectId="p1" onClose={() => {}} />)
    })
    await act(async () => {})
  }

  it('다섯 항목을 세로로 쌓지 않고 2열 그리드에 담는다', async () => {
    await render()
    const dl = container.querySelector('dl')
    expect(dl).toBeTruthy()
    expect(dl!.className).toContain('grid')
    expect(dl!.className).toContain('grid-cols-2')
    expect(dl!.querySelectorAll('dt')).toHaveLength(5)
  })

  it('라벨은 값 위에 온다 — 좌우 배치면 칸이 넓어져 두 열이 안 들어간다', async () => {
    await render()
    const cell = container.querySelector('dt')!.parentElement!
    // 한 칸 안에서 dt 다음이 dd. 좌우 2열 그리드였을 때와 달리 셀 자체는 가로 분할이 없다.
    expect(cell.children[0].tagName).toBe('DT')
    expect(cell.children[1].tagName).toBe('DD')
    expect(cell.className).not.toContain('grid-cols-')
  })

  it('산출물만 두 칸을 다 쓴다 — 길고 편집 입력이 열리는 항목이다', async () => {
    await render()
    const cells = [...container.querySelectorAll('dl > div')]
    const deliverable = cells.find(c => c.querySelector('dt')?.textContent === realT('ko', 'wbs.colDeliverable'))
    expect(deliverable).toBeTruthy()
    expect(deliverable!.className).toContain('col-span-2')

    const status = cells.find(c => c.querySelector('dt')?.textContent === realT('ko', 'wbs.colStatus'))
    expect(status!.className).not.toContain('col-span-2')
  })

  it('값은 그대로 보인다 — 배치만 바뀌었지 항목이 사라지지 않았다', async () => {
    await render(computedItem({ weight: 3 }))
    const dl = container.querySelector('dl')!
    expect(dl.textContent).toContain('26.08.31')
    expect(dl.textContent).toContain('26.09.02')
    expect(dl.textContent).toContain('300%')
    expect(dl.textContent).toContain(realT('ko', 'wbs.unassigned'))
  })
})
