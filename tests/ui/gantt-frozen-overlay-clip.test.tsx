// @vitest-environment jsdom
// 회귀 가드 — 간트 오버레이(이정표·오늘선)가 가로 스크롤 시 동결 열(#·구분·작업명)을 침범하던 버그.
// 행이 z-10 스태킹 컨텍스트라 동결 셀의 zIndex:20은 행 내부에서만 유효하고, 형제인 오버레이(z-25/30)가
// 항상 위에 그려진다. 수정은 z가 아니라 clip: 스크롤 위치(--wbs-scroll-x)를 따라 오버레이 왼쪽을 잘라낸다.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: {} }),
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: vi.fn(),
  queueWbsCollapse: vi.fn(),
}))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(),
  updateWeight: vi.fn(),
  addWbsItem: vi.fn(),
}))
vi.mock('@/components/app/usePagePresence', () => ({
  usePagePresence: () => [],
}))
vi.mock('@/components/report/ReportModal', () => ({
  ReportModal: () => null,
}))
vi.mock('@/components/wbs/RowDetailPanel', () => ({
  RowDetailPanel: () => null,
}))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import type { ComputedItem } from '@/lib/domain/types'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], depth: 0, ...over,
})

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function render(ui: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(ui))
}

describe('간트 오버레이 동결 열 클리핑', () => {
  const items: ComputedItem[] = [
    leaf({
      id: 'phase1', parentId: null, name: '1. 실행', depth: 0, plannedStart: '2026-08-01', plannedEnd: '2026-08-31',
      children: [
        leaf({ id: 'ms1', parentId: 'phase1', name: '중간보고', depth: 1, plannedStart: '2026-08-18', plannedEnd: '2026-08-20' }),
      ],
    }),
  ]

  const renderSheet = () =>
    render(
      <LocaleProvider initialLocale="ko">
        <WbsGanttSheet
          items={items}
          holidays={[]}
          today="2026-08-10"
          actorView={null}
          projectId="p1"
          readOnly
          milestoneKeywords={['보고']}
        />
      </LocaleProvider>,
    )

  it('이정표·오늘 오버레이는 스크롤 변수 기반 clip-path를 갖는다', () => {
    renderSheet()
    const ms = document.querySelector('[data-wbs-milestone-overlay]') as HTMLElement | null
    const today = document.querySelector('[data-wbs-today-overlay]') as HTMLElement | null
    expect(ms).not.toBeNull()
    expect(today).not.toBeNull()
    expect(ms!.style.clipPath).toContain('var(--wbs-scroll-x')
    expect(today!.style.clipPath).toContain('var(--wbs-scroll-x')
    // 예정 마일스톤 선은 바이올렛(#7c3aed) — 간트의 초록 포화 때문에 대시보드 배색과 의도적으로 다르다
    const line = document.querySelector('[data-wbs-milestone-line]') as HTMLElement | null
    expect(line).not.toBeNull()
    expect(line!.className).toContain('border-[#7c3aed]')
  })

  it('칩(이정표·오늘)은 세로 스크롤을 따라오도록 sticky로 붙는다', () => {
    renderSheet()
    const msChip = document.querySelector('[data-wbs-milestone-chip]') as HTMLElement | null
    const todayChip = document.querySelector('[data-wbs-today-chip]') as HTMLElement | null
    expect(msChip).not.toBeNull()
    expect(todayChip).not.toBeNull()
    // position은 Tailwind 'sticky' 클래스로 적용된다 — jsdom은 클래스 CSS를 계산하지 않으므로 클래스로 검증
    expect(msChip!.classList.contains('sticky')).toBe(true)
    expect(msChip!.style.top).toContain('--wbs-head-h')
    expect(todayChip!.classList.contains('sticky')).toBe(true)
    expect(todayChip!.style.top).toContain('--wbs-head-h')
  })

  it('가로 스크롤이 --wbs-scroll-x 변수를 갱신한다', () => {
    renderSheet()
    const region = document.querySelector('[data-wbs-scroll-region]') as HTMLElement
    region.scrollLeft = 500
    act(() => {
      region.dispatchEvent(new Event('scroll'))
    })
    expect(region.style.getPropertyValue('--wbs-scroll-x')).toBe('500px')
  })
})
