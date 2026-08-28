// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'
import { t as realT } from '@/lib/i18n/dict'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({
  getChangeLogs: vi.fn().mockResolvedValue([]),
  updateWbsFields: vi.fn(),
  updateDeliverable: vi.fn(),
  addWbsItem: vi.fn(),
  addSubAct: vi.fn(),
  deleteWbsItem: vi.fn(),
  moveWbsItem: vi.fn(),
  addTaskDependency: vi.fn(),
  removeTaskDependency: vi.fn(),
}))
vi.mock('@/app/actions/attachments', () => ({
  listAttachments: vi.fn().mockResolvedValue([]),
  recordAttachment: vi.fn(),
  removeAttachment: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => realT('ko', k as Parameters<typeof realT>[1]) }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => [] }))
// 담당·단계 패널은 자체 데이터 로드를 갖고 있어 이 테스트의 관심사가 아니다 — no-op 처리.
vi.mock('@/components/wbs/WbsAssigneeStagePanel', () => ({ WbsAssigneeStagePanel: () => null }))

import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'

function computedItem(id: string, over: Partial<ComputedItem> = {}): ComputedItem {
  return {
    id, parentId: null, code: id, sortOrder: 1, name: `작업 ${id}`,
    biz: null, deliverable: null, plannedStart: '2026-08-01', plannedEnd: '2026-08-10',
    weight: null, actualPct: 0, owners: [], isOwnerSplit: false,
    plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started',
    children: [], depth: 0,
    ...over,
  }
}

function dep(over: Partial<TaskDependency> = {}): TaskDependency {
  return { id: 'dep-1', projectId: 'p1', predecessorId: 'pred-1', successorId: 'item-1', type: 'FS', lagDays: 0, origin: 'manual', ...over }
}

describe('RowDetailPanel — 선행/후속 섹션', () => {
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

  async function render(opts: {
    item: ComputedItem
    allItems: ComputedItem[]
    dependencies: TaskDependency[]
    onSelectItem?: (id: string) => void
  }) {
    await act(async () =>
      root.render(
        <RowDetailPanel
          item={opts.item}
          allItems={opts.allItems}
          dependencies={opts.dependencies}
          projectId="p1"
          onClose={() => {}}
          onSelectItem={opts.onSelectItem}
        />,
      ),
    )
    await act(async () => {}) // getChangeLogs/listAttachments 비동기 이펙트 플러시
  }

  it('선행 FS 가 미완료면 "선행 1건 대기 중" 배너와 그 선행 행에 "대기" 배지가 뜬다', async () => {
    const predecessor = computedItem('pred-1', { name: '선행 작업 A', rolledActualPct: 40 })
    const item = computedItem('item-1', { name: '대상 작업' })
    await render({ item, allItems: [predecessor, item], dependencies: [dep()] })

    expect(container.textContent).toContain('선행 1건 대기 중')
    // 대기 배지는 선행 행에 붙는다 — 선행 이름 근처에서 '대기' 텍스트를 찾는다.
    const predRow = [...container.querySelectorAll('li')].find(li => li.textContent?.includes('선행 작업 A'))
    expect(predRow).toBeTruthy()
    expect(predRow!.textContent).toContain('대기')
  })

  it('선행이 전부 충족되면 "선행 충족 — 시작 가능" 배너가 뜬다', async () => {
    const predecessor = computedItem('pred-1', { name: '선행 작업 A', rolledActualPct: 100 })
    const item = computedItem('item-1', { name: '대상 작업' })
    await render({ item, allItems: [predecessor, item], dependencies: [dep()] })

    expect(container.textContent).toContain('선행 충족 — 시작 가능')
  })

  it('선행 이름을 클릭하면 onSelectItem 이 그 선행 id 로 호출된다', async () => {
    const predecessor = computedItem('pred-1', { name: '선행 작업 A', rolledActualPct: 40 })
    const item = computedItem('item-1', { name: '대상 작업' })
    const onSelectItem = vi.fn()
    await render({ item, allItems: [predecessor, item], dependencies: [dep()], onSelectItem })

    const nameButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('선행 작업 A'))
    expect(nameButton).toBeTruthy()
    await act(async () => { nameButton!.click() })
    expect(onSelectItem).toHaveBeenCalledWith('pred-1')
  })

  it('후속 의존성이 없으면 "등록된 후속 작업이 없습니다." 가 보인다', async () => {
    const item = computedItem('item-1', { name: '대상 작업' })
    await render({ item, allItems: [item], dependencies: [] })

    expect(container.textContent).toContain('등록된 후속 작업이 없습니다.')
  })
})
