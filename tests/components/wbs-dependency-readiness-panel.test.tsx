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
    unresolvedRefs?: string[]
    editable?: boolean
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
          unresolvedRefs={opts.unresolvedRefs}
          editable={opts.editable ?? false}
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

  describe('wbs.md 에서 합성된 선행(origin=spec)', () => {
    const spec = (over: Partial<TaskDependency> = {}) =>
      dep({ id: 'spec:pred-1>item-1', origin: 'spec', ...over })

    // 대조군 — editable 이 켜져야 삭제 버튼 부재 검사가 공허하지 않다.
    it('편집 권한이 있으면 manual 행에는 삭제 버튼이 붙는다', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [predecessor, item], dependencies: [dep()], editable: true })
      const predRow = [...container.querySelectorAll('li')].find(li => li.textContent?.includes('선행 작업 A'))
      expect(predRow!.querySelector('button[aria-label="의존성 삭제"]')).not.toBeNull()
    })

    it("'가져옴' 배지를 달고 삭제 버튼을 주지 않는다 — 정본이 wbs.md 라 지워도 되살아난다", async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A', stage: 'im' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [predecessor, item], dependencies: [spec()], editable: true })

      const predRow = [...container.querySelectorAll('li')].find(li => li.textContent?.includes('선행 작업 A'))
      expect(predRow!.textContent).toContain('가져옴')
      expect(predRow!.querySelector('button[aria-label="의존성 삭제"]')).toBeNull()
    })

    it('실적이 아니라 stage 로 판정한다 — 실적 100% 여도 stage 가 ip 면 대기', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A', rolledActualPct: 100, stage: 'ip' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [predecessor, item], dependencies: [spec()] })

      expect(container.textContent).toContain('선행 1건 대기 중')
    })

    it('stage 가 im 이면 실적 0 이어도 시작 가능', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A', rolledActualPct: 0, stage: 'im' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [predecessor, item], dependencies: [spec()] })

      expect(container.textContent).toContain('선행 충족 — 시작 가능')
    })
  })

  describe('해석 못 한 선행 ref', () => {
    // claim 게이트가 409 를 내는 상태다. 목록에서 빼면 '선행 없음 → 시작 가능'으로 위장한다.
    it('선행 목록에 ref 마지막 마디로 한 줄 남기고 시작을 막는다', async () => {
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [item], dependencies: [], unresolvedRefs: ['mes/TSK-99'] })

      expect(container.textContent).toContain('TSK-99')
      expect(container.textContent).toContain('선행 1건을 확인할 수 없음')
      expect(container.textContent).not.toContain('등록된 선행 작업이 없습니다.')
    })

    it('충족된 선행이 따로 있어도 시작 가능으로 넘어가지 않는다', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A', rolledActualPct: 100 })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({
        item, allItems: [predecessor, item], dependencies: [dep()], unresolvedRefs: ['mes/TSK-99'],
      })

      expect(container.textContent).toContain('선행 1건을 확인할 수 없음')
      expect(container.textContent).not.toContain('선행 충족 — 시작 가능')
    })
  })

  describe('선행 추가 후보', () => {
    // 병합으로 합성 선행이 incomingDependencies 에 들어오면서 후보 목록이 조용히 좁아졌던 자리.
    // 합성 선행에는 FS/SS·lag 가 없으므로, 실제 행으로 얹을 길을 막으면 안 된다.
    it('wbs.md 로 이미 이어진 선행도 후보에 남는다', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A', stage: 'im' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({
        item,
        allItems: [predecessor, item],
        dependencies: [dep({ id: 'spec:pred-1>item-1', origin: 'spec' })],
        editable: true,
      })

      const addToggle = [...container.querySelectorAll('button')]
        .find(b => b.textContent?.includes('선행 추가'))
      expect(addToggle).toBeTruthy()
      await act(async () => { addToggle!.click() })

      const options = [...container.querySelectorAll('option')].map(o => o.textContent ?? '')
      expect(options.some(o => o.includes('선행 작업 A'))).toBe(true)
    })

    it('실제 행으로 이미 이어진 선행은 후보에서 빠진다', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({
        item, allItems: [predecessor, item], dependencies: [dep()], editable: true,
      })

      const addToggle = [...container.querySelectorAll('button')]
        .find(b => b.textContent?.includes('선행 추가'))
      await act(async () => { addToggle!.click() })

      const options = [...container.querySelectorAll('option')].map(o => o.textContent ?? '')
      expect(options.some(o => o.includes('선행 작업 A'))).toBe(false)
    })
  })

  describe('그래프 뷰', () => {
    async function toGraph() {
      const btn = [...container.querySelectorAll('button')].find(b => b.textContent === '그래프')
      expect(btn).toBeTruthy()
      await act(async () => { btn!.click() })
    }

    it('토글로 목록과 그래프를 오간다', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [predecessor, item], dependencies: [dep()] })

      expect(container.querySelectorAll('li').length).toBeGreaterThan(0)
      await toGraph()
      expect(container.querySelectorAll('li').length).toBe(0)
      expect(container.textContent).toContain('선행 작업 A')
    })

    it('선행은 왼쪽, 후행은 오른쪽, 가운데는 선택된 작업이다', async () => {
      const pred = computedItem('pred-1', { name: '선행 작업 A' })
      const succ = computedItem('succ-1', { name: '후행 작업 B' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({
        item,
        allItems: [pred, succ, item],
        dependencies: [
          dep({ id: 'd-in', predecessorId: 'pred-1', successorId: 'item-1' }),
          dep({ id: 'd-out', predecessorId: 'item-1', successorId: 'succ-1' }),
        ],
      })
      await toGraph()

      const center = container.querySelector('[aria-current="true"]')
      expect(center?.textContent).toContain('대상 작업')

      const cols = [...container.querySelectorAll('[data-slots]')]
      expect(cols).toHaveLength(2)
      expect(cols[0].textContent).toContain('선행 작업 A')
      expect(cols[1].textContent).toContain('후행 작업 B')
    })

    it('더블클릭하면 그 작업으로 이동한다 — 한 번 클릭으로는 안 움직인다', async () => {
      const pred = computedItem('pred-1', { name: '선행 작업 A' })
      const item = computedItem('item-1', { name: '대상 작업' })
      const onSelectItem = vi.fn()
      await render({ item, allItems: [pred, item], dependencies: [dep()], onSelectItem })
      await toGraph()

      const node = [...container.querySelectorAll('[role="button"]')]
        .find(n => n.textContent?.includes('선행 작업 A')) as HTMLElement
      expect(node).toBeTruthy()

      await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(onSelectItem).not.toHaveBeenCalled()

      await act(async () => { node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
      expect(onSelectItem).toHaveBeenCalledWith('pred-1')
    })

    it('해석 못 한 선행도 그래프에 노드로 남는다 — 목록에서만 고친 것이 아니다', async () => {
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [item], dependencies: [], unresolvedRefs: ['mes/TSK-99'] })
      await toGraph()

      const cols = [...container.querySelectorAll('[data-slots]')]
      expect(cols[0].textContent).toContain('TSK-99')
      expect(cols[0].textContent).toContain('확인 불가')
      // 가리킬 작업이 없으므로 이동 대상이 아니다.
      expect(cols[0].querySelector('[role="button"]')).toBeNull()
    })

    it("합성 선행은 그래프에서도 '가져옴' 을 단다", async () => {
      const pred = computedItem('pred-1', { name: '선행 작업 A', stage: 'im' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({
        item, allItems: [pred, item],
        dependencies: [dep({ id: 'spec:pred-1>item-1', origin: 'spec' })],
      })
      await toGraph()

      const cols = [...container.querySelectorAll('[data-slots]')]
      expect(cols[0].textContent).toContain('가져옴')
      expect(cols[0].textContent).toContain('충족')
    })

    it('연결선은 선행·후행 개수만큼 그린다', async () => {
      const pred = computedItem('pred-1', { name: '선행 A' })
      const pred2 = computedItem('pred-2', { name: '선행 B' })
      const succ = computedItem('succ-1', { name: '후행 C' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({
        item,
        allItems: [pred, pred2, succ, item],
        dependencies: [
          dep({ id: 'd1', predecessorId: 'pred-1', successorId: 'item-1' }),
          dep({ id: 'd2', predecessorId: 'pred-2', successorId: 'item-1' }),
          dep({ id: 'd3', predecessorId: 'item-1', successorId: 'succ-1' }),
        ],
      })
      await toGraph()

      expect(container.querySelectorAll('svg path[marker-end]').length).toBe(3)
    })
  })

  describe('챕터 접기', () => {
    function header() {
      return [...container.querySelectorAll('button[aria-expanded]')]
        .find(b => b.textContent?.includes('작업 의존성')) as HTMLElement
    }

    it('기본은 펼침 — 접으면 본문이 사라지고 다시 누르면 돌아온다', async () => {
      const predecessor = computedItem('pred-1', { name: '선행 작업 A' })
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [predecessor, item], dependencies: [dep()] })

      expect(container.textContent).toContain('선행 작업 A')

      await act(async () => { header().click() })
      expect(header().getAttribute('aria-expanded')).toBe('false')
      expect(container.textContent).not.toContain('선행 작업 A')
      // 제목은 남는다 — 챕터가 사라지는 게 아니라 접히는 것이다.
      expect(container.textContent).toContain('작업 의존성')

      await act(async () => { header().click() })
      expect(container.textContent).toContain('선행 작업 A')
    })

    it('접으면 목록/그래프 토글도 같이 감춘다', async () => {
      const item = computedItem('item-1', { name: '대상 작업' })
      await render({ item, allItems: [item], dependencies: [] })

      expect([...container.querySelectorAll('button')].some(b => b.textContent === '그래프')).toBe(true)
      await act(async () => { header().click() })
      expect([...container.querySelectorAll('button')].some(b => b.textContent === '그래프')).toBe(false)
    })
  })
})

