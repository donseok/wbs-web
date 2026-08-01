// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(),
  updateWeight: vi.fn(),
  addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/components/wbs/RowDetailPanel', () => ({
  RowDetailPanel: () => null,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueWbsCollapse: vi.fn(),
}))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

const item: ComputedItem = {
  id: 'a1',
  parentId: null,
  level: 'activity',
  code: '1.1',
  sortOrder: 0,
  name: 'ERP 전환 준비',
  biz: null,
  deliverable: '업무분장표',
  plannedStart: '2026-07-01',
  plannedEnd: '2026-07-10',
  weight: 1,
  actualPct: 48,
  owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: false,
  plannedPct: 65,
  rolledActualPct: 48,
  achievement: 74,
  status: 'in_progress',
  children: [],
  depth: 0,
}

const secondItem: ComputedItem = {
  ...item,
  id: 'a2',
  code: '1.2',
  sortOrder: 1,
  name: '데이터 이관',
  deliverable: '이관 결과서',
  plannedPct: 80,
  rolledActualPct: 82,
  achievement: 102.5,
  status: 'done',
}

// isOwnerSplit(SUB-ACT) 항목 — C2 에서 LevelBadge 로 depth+isOwnerSplit 배선을 잡은 잠복버그의 회귀 방지 픽스처.
const subActItem: ComputedItem = {
  ...item,
  id: 's1',
  code: '1.1 (가공)',
  sortOrder: 2,
  name: 'ERP 전환 준비 (가공)',
  owners: [{ team: '가공', kind: 'primary' }],
  isOwnerSplit: true,
}

describe('WbsGanttSheet — 진척 돋보기', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(
      <WbsGanttSheet
        items={[item, secondItem, subActItem]}
        holidays={[]}
        today="2026-07-03"
        actorView={null}
        projectId="p1"
        readOnly
      />,
    ))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const toggle = () =>
    container.querySelector<HTMLButtonElement>('[data-wbs-progress-lens-toggle]')!

  const row = (id = 'a1') =>
    container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!

  const guide = () =>
    container.querySelector<HTMLElement>('[data-wbs-progress-lens-guide]')

  const card = () =>
    container.querySelector<HTMLElement>('[data-wbs-progress-lens-card]')

  const pin = () =>
    container.querySelector<HTMLButtonElement>('[data-wbs-progress-lens-pin]')!

  const enable = async () => {
    await act(async () => toggle().click())
  }

  const hoverRow = (id = 'a1') => {
    act(() => {
      row(id).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
  }

  const leaveRow = (id = 'a1') => {
    act(() => {
      row(id).dispatchEvent(new MouseEvent('mouseout', {
        bubbles: true,
        relatedTarget: document.body,
      }))
    })
  }

  it('기본값은 OFF이며 안내와 확대 카드를 렌더하지 않는다', () => {
    expect(toggle()).not.toBeNull()
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(guide()).toBeNull()
    expect(card()).toBeNull()
  })

  it('토글을 켜면 사용 안내를 표시하고 마지막 hover 카드를 유지한다', async () => {
    await enable()

    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(guide()?.textContent).toContain('wbs.progressLensGuide')
    expect(card()).toBeNull()

    hoverRow()
    expect(guide()).toBeNull()
    expect(card()?.dataset.itemId).toBe('a1')

    leaveRow()
    expect(card()?.dataset.itemId).toBe('a1')
    expect(guide()).toBeNull()
  })

  it('키보드로 행 안의 작업명에 focus하면 같은 행의 카드를 표시한다', async () => {
    await enable()

    const nameButton = row().querySelector<HTMLButtonElement>(
      '[data-wbs-col="name"] button',
    )!
    act(() => nameButton.focus())

    expect(document.activeElement).toBe(nameButton)
    expect(card()?.dataset.itemId).toBe('a1')
  })

  it('핀으로 고정하면 다른 행 hover를 무시하고 해제 후 다시 따라간다', async () => {
    await enable()
    hoverRow()

    await act(async () => pin().click())
    expect(pin().getAttribute('aria-pressed')).toBe('true')
    expect(card()?.dataset.pinned).toBe('true')

    leaveRow()
    expect(card()?.dataset.itemId).toBe('a1')
    expect(card()?.dataset.pinned).toBe('true')

    hoverRow('a2')
    expect(card()?.dataset.itemId).toBe('a1')

    await act(async () => pin().click())
    expect(card()?.dataset.pinned).toBe('false')

    hoverRow('a2')
    expect(card()?.dataset.itemId).toBe('a2')
  })

  it('Escape는 고정 카드를 해제하되 돋보기 모드는 유지한다', async () => {
    await enable()
    hoverRow()
    await act(async () => pin().click())
    leaveRow()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }))
    })

    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(card()).toBeNull()
    expect(guide()).not.toBeNull()
  })

  it('OFF로 전환하면 활성·고정 상태를 정리하고 다시 켜도 이전 카드를 복원하지 않는다', async () => {
    await enable()
    hoverRow()
    await act(async () => pin().click())

    await act(async () => toggle().click())
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(card()).toBeNull()
    expect(guide()).toBeNull()

    leaveRow()
    hoverRow()
    expect(card()).toBeNull()

    await enable()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(card()).toBeNull()
    expect(guide()).not.toBeNull()
  })

  it('카드에 핵심 진척 데이터와 계획 대비 차이, 두 진행 막대를 정확히 표시한다', async () => {
    await enable()
    hoverRow()

    const lens = card()!
    const field = (name: string) =>
      lens.querySelector<HTMLElement>(`[data-lens-field="${name}"]`)!

    expect(field('name').textContent).toBe('ERP 전환 준비')
    expect(field('path').textContent).toBe('1.1')
    expect(field('owners').textContent).toContain('PMO')
    expect(field('status').textContent).toContain('status.in_progress')
    expect(field('schedule').textContent).toContain('26.07.01 ~ 26.07.10')
    expect(field('deliverable').textContent).toContain('업무분장표')
    expect(field('planned').textContent).toContain('65.0%')
    expect(field('actual').textContent).toContain('48.0%')
    expect(field('delta').textContent).toContain('-17.0%p')
    expect(field('achievement').textContent).toContain('74.0%')

    const plannedBar = lens.querySelector<HTMLElement>(
      '[data-lens-bar="planned"] [role="progressbar"]',
    )!
    const actualBar = lens.querySelector<HTMLElement>(
      '[data-lens-bar="actual"] [role="progressbar"]',
    )!

    expect(plannedBar.getAttribute('aria-valuenow')).toBe('65')
    expect(actualBar.getAttribute('aria-valuenow')).toBe('48')
    expect((plannedBar.firstElementChild as HTMLElement).style.width).toBe('65%')
    expect((actualBar.firstElementChild as HTMLElement).style.width).toBe('48%')
  })

  it('SUB-ACT(isOwnerSplit=true) 항목을 hover 하면 카드 배지가 SUB-ACT 로 뜬다', async () => {
    await enable()
    hoverRow('s1')

    expect(card()?.dataset.itemId).toBe('s1')
    expect(card()!.querySelector('.lvl-badge')?.textContent).toBe('SUB-ACT')
  })
})
