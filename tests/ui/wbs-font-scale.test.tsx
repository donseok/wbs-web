// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'
import { WBS_FONT_SCALE_STORAGE_KEY } from '@/lib/wbsFontScale'

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

const itemA: ComputedItem = {
  id: 'A',
  parentId: null,
  level: 'activity',
  code: '1.1',
  sortOrder: 0,
  name: 'ERP 전환 준비',
  biz: null,
  deliverable: '업무분장표',
  plannedStart: '2026-07-01',
  plannedEnd: '2026-07-05',
  weight: 0.5,
  actualPct: 48,
  owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: false,
  plannedPct: 65,
  rolledActualPct: 48,
  achievement: 74,
  status: 'in_progress',
  children: [],
  depth: 0,
}

const itemB: ComputedItem = {
  ...itemA,
  id: 'B',
  code: '1.2',
  sortOrder: 1,
  name: '데이터 이관',
  deliverable: '이관 결과서',
  plannedStart: '2026-07-06',
  plannedEnd: '2026-07-10',
  plannedPct: 80,
  rolledActualPct: 82,
  achievement: 102.5,
  status: 'done',
}

const dependencies: TaskDependency[] = [{
  id: 'd1',
  projectId: 'p1',
  predecessorId: 'A',
  successorId: 'B',
  type: 'FS',
  lagDays: 0,
}]

const EXPECTED_FONT_VARS = {
  100: {
    '--wbs-cell-font': '12px',
    '--wbs-index-font': '11px',
    '--wbs-head-font': '10px',
    '--wbs-timeline-font': '9.5px',
    '--wbs-day-font': '9px',
    '--wbs-chip-font': '11px',
    '--wbs-badge-font': '10px',
    '--wbs-owner-font': '10.5px',
    '--wbs-owner-mark-font': '9px',
    '--wbs-bar-font': '9px',
  },
  115: {
    '--wbs-cell-font': '13.8px',
    '--wbs-index-font': '12.65px',
    '--wbs-head-font': '11.5px',
    '--wbs-timeline-font': '10.93px',
    '--wbs-day-font': '10.35px',
    '--wbs-chip-font': '12.65px',
    '--wbs-badge-font': '10.5px',
    '--wbs-owner-font': '12.07px',
    '--wbs-owner-mark-font': '10.35px',
    '--wbs-bar-font': '10.35px',
  },
  130: {
    '--wbs-cell-font': '15.6px',
    '--wbs-index-font': '14.3px',
    '--wbs-head-font': '13px',
    '--wbs-timeline-font': '12.35px',
    '--wbs-day-font': '11.7px',
    '--wbs-chip-font': '13px',
    '--wbs-badge-font': '10.5px',
    '--wbs-owner-font': '13.65px',
    '--wbs-owner-mark-font': '11.7px',
    '--wbs-bar-font': '11.7px',
  },
} as const

const HIDEABLE_COLS = [
  'owners',
  'status',
  'deliverable',
  'pstart',
  'pend',
  'weight',
  'pplan',
]

describe('WbsGanttSheet — 표 글자 크기 3단계', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
  })

  async function mount() {
    await act(async () => root.render(
      <WbsGanttSheet
        items={[itemA, itemB]}
        dependencies={dependencies}
        holidays={[]}
        today="2026-07-03"
        actorView={null}
        projectId="p1"
        readOnly
      />,
    ))
  }

  function sheet(): HTMLElement {
    return container.querySelector<HTMLElement>('[data-wbs-gantt-sheet]')!
  }

  function scrollRegion(): HTMLElement {
    return container.querySelector<HTMLElement>('[data-wbs-scroll-region]')!
  }

  function control(): HTMLElement {
    return container.querySelector<HTMLElement>('[data-wbs-font-scale-control]')!
  }

  function decrease(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>('[data-wbs-font-scale-decrease]')!
  }

  function reset(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>('[data-wbs-font-scale-reset]')!
  }

  function increase(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>('[data-wbs-font-scale-increase]')!
  }

  function expectScale(scale: 100 | 115 | 130) {
    expect(sheet().dataset.wbsFontScale).toBe(String(scale))
    expect(control().dataset.currentScale).toBe(String(scale))
    expect(reset().textContent).toContain(`${scale}%`)
    Object.entries(EXPECTED_FONT_VARS[scale]).forEach(([name, value]) => {
      expect(scrollRegion().style.getPropertyValue(name)).toBe(value)
    })
  }

  function layoutSnapshot() {
    const headerWidths = [
      'no',
      'level',
      'name',
      'owners',
      'status',
      'deliverable',
      'pstart',
      'pend',
      'weight',
      'pplan',
      'pactual',
      'achieve',
    ].map(key =>
      container.querySelector<HTMLElement>(
        `[data-wbs-col="${key}"][data-wbs-col-kind="header"]`,
      )?.style.width,
    )
    const row = container.querySelector<HTMLElement>('[data-row-id="A"]')!
    const ganttCell = row.lastElementChild as HTMLElement
    const ganttBar = ganttCell.firstElementChild as HTMLElement
    const dependencyOverlay = container.querySelector<SVGSVGElement>('svg.z-20')!
    const dependencyPath = dependencyOverlay.querySelector<SVGPathElement>('path[marker-end]')!
    const scrollContent = container.querySelector<HTMLElement>('[data-wbs-scroll-content]')!
    const headerRow = container.querySelector<HTMLElement>(
      '[data-wbs-col="name"][data-wbs-col-kind="header"]',
    )!.parentElement!
    const ganttHeader = headerRow.lastElementChild as HTMLElement

    return {
      leftWidth: sheet().style.getPropertyValue('--wbs-left-w'),
      scrollContentWidth: scrollContent.style.width,
      headerWidths,
      ganttHeaderWidth: ganttHeader.style.width,
      ganttCellWidth: ganttCell.style.width,
      ganttBarLeft: ganttBar.style.left,
      ganttBarWidth: ganttBar.style.width,
      dependencyLeft: dependencyOverlay.style.left,
      dependencyViewBox: dependencyOverlay.getAttribute('viewBox'),
      dependencyPath: dependencyPath.getAttribute('d'),
    }
  }

  it('저장값이 없으면 100%를 적용하고 축소 버튼을 경계에서 비활성화한다', async () => {
    await mount()

    expectScale(100)
    expect(control().getAttribute('role')).toBe('group')
    expect(decrease().disabled).toBe(true)
    expect(increase().disabled).toBe(false)
    expect(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY)).toBeNull()
  })

  it('A+/A-/현재값 버튼으로 100→115→130 세 단계를 이동하고 기본값으로 리셋한다', async () => {
    await mount()

    await act(async () => increase().click())
    expectScale(115)
    expect(decrease().disabled).toBe(false)
    expect(increase().disabled).toBe(false)
    expect(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY)).toBe('115')

    await act(async () => increase().click())
    expectScale(130)
    expect(increase().disabled).toBe(true)
    expect(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY)).toBe('130')

    await act(async () => decrease().click())
    expectScale(115)
    expect(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY)).toBe('115')

    await act(async () => reset().click())
    expectScale(100)
    expect(decrease().disabled).toBe(true)
    expect(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY)).toBe('100')
  })

  it('사용자가 선택한 단계를 새 WBS 마운트에서도 복원한다', async () => {
    await mount()
    await act(async () => increase().click())
    await act(async () => increase().click())
    expect(localStorage.getItem(WBS_FONT_SCALE_STORAGE_KEY)).toBe('130')

    act(() => root.unmount())
    root = createRoot(container)
    await mount()

    expectScale(130)
    expect(increase().disabled).toBe(true)
  })

  it.each(['', '99', '114', '131', '크게'])(
    '손상되거나 지원하지 않는 저장값 %j은 100%%로 안전하게 복구한다',
    async stored => {
      localStorage.setItem(WBS_FONT_SCALE_STORAGE_KEY, stored)
      await mount()

      expectScale(100)
      expect(decrease().disabled).toBe(true)
      expect(increase().disabled).toBe(false)
    },
  )

  it('열 숨김과 고정된 진척 돋보기 상태는 글자 크기 변경과 서로 독립적이다', async () => {
    await mount()

    const lensToggle = container.querySelector<HTMLButtonElement>(
      '[data-wbs-progress-lens-toggle]',
    )!
    const columnsToggle = container.querySelector<HTMLButtonElement>(
      '[data-wbs-columns-toggle]',
    )!
    await act(async () => lensToggle.click())
    act(() => {
      container.querySelector<HTMLElement>('[data-row-id="A"]')!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true }),
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-wbs-progress-lens-pin]')!.click()
    })
    await act(async () => columnsToggle.click())
    await act(async () => increase().click())

    expectScale(115)
    expect(columnsToggle.getAttribute('aria-expanded')).toBe('false')
    HIDEABLE_COLS.forEach(key => {
      expect(container.querySelectorAll(`[data-wbs-col="${key}"]`)).toHaveLength(0)
    })
    expect(lensToggle.getAttribute('aria-pressed')).toBe('true')
    const lens = container.querySelector<HTMLElement>('[data-wbs-progress-lens-card]')!
    expect(lens.dataset.itemId).toBe('A')
    expect(lens.dataset.pinned).toBe('true')

    await act(async () => columnsToggle.click())
    await act(async () => lensToggle.click())

    expectScale(115)
    expect(columnsToggle.getAttribute('aria-expanded')).toBe('true')
    HIDEABLE_COLS.forEach(key => {
      expect(container.querySelectorAll(`[data-wbs-col="${key}"]`)).toHaveLength(3)
    })
    expect(lensToggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('글자만 확대하며 열 폭·간트 바·의존선의 좌표와 폭은 바꾸지 않는다', async () => {
    await mount()

    const baseline = layoutSnapshot()
    expect(baseline.leftWidth).toBe('1198px')
    expect(baseline.headerWidths).toEqual([
      '44px',
      '60px',
      '300px',
      '128px',
      '76px',
      '150px',
      '80px',
      '80px',
      '64px',
      '68px',
      '72px',
      '76px',
    ])
    expect(baseline.ganttHeaderWidth).toBe(baseline.ganttCellWidth)
    expect(baseline.dependencyPath).toBeTruthy()

    await act(async () => increase().click())
    expectScale(115)
    expect(layoutSnapshot()).toEqual(baseline)

    await act(async () => increase().click())
    expectScale(130)
    expect(layoutSnapshot()).toEqual(baseline)
  })

  it('130%에서도 고정 폭 구분·상태 셀이 라벨을 보존하도록 내부 여백과 상한을 적용한다', async () => {
    await mount()
    await act(async () => increase().click())
    await act(async () => increase().click())

    const row = container.querySelector<HTMLElement>('[data-row-id="A"]')!
    const levelCell = row.querySelector<HTMLElement>('[data-wbs-col="level"]')!
    const levelBadge = levelCell.querySelector<HTMLElement>('.lvl-badge')!
    const statusCell = row.querySelector<HTMLElement>('[data-wbs-col="status"]')!
    const statusChip = statusCell.querySelector<HTMLElement>('.chip')!

    expect(scrollRegion().style.getPropertyValue('--wbs-badge-font')).toBe('10.5px')
    expect(levelCell.classList.contains('overflow-hidden')).toBe(true)
    expect(levelCell.style.paddingInline).toBe('4px')
    expect(levelBadge.style.maxWidth).toBe('100%')
    expect(levelBadge.style.paddingInline).toBe('3px')
    expect(levelBadge.style.letterSpacing).toBe('0px')

    expect(scrollRegion().style.getPropertyValue('--wbs-chip-font')).toBe('13px')
    expect(statusCell.style.paddingInline).toBe('4px')
    expect(statusChip.style.paddingInline).toBe('4px')
    expect(statusChip.getAttribute('aria-label')).toBe('status.in_progress')
    expect(statusChip.querySelector('.truncate')?.textContent).toBe('status.in_progress')
  })
})
