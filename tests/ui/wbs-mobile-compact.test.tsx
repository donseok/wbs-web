// @vitest-environment jsdom
// 모바일 압축(2026-08-21): 좁은 화면에서 툴바 버튼은 아이콘만 남기고 글자는 sm 이상에서만.
// 히어로(PageHero)는 모바일에서 숨긴다 — 프로젝트명은 헤더(햄버거 옆)가 대신 보여준다.
// jsdom 은 미디어쿼리를 실행하지 않으므로 클래스 계약(hidden sm:inline / hidden md:grid)을 검사한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { PageHero } from '@/components/ui/PageHero'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

describe('WBS 모바일 압축', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function render() {
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1' })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
  }

  it('툴바는 모바일에서도 flex-wrap — 2열 그리드 강제 배치를 쓰지 않는다', async () => {
    await render()
    const toolbar = container.querySelector<HTMLElement>('[data-wbs-toolbar]')
    expect(toolbar).not.toBeNull()
    expect(toolbar!.className).toContain('flex-wrap')
    expect(toolbar!.className).not.toContain('grid-cols')
  })

  it('버튼 글자 라벨은 전부 sm 이상에서만 보인다(hidden sm:inline)', async () => {
    await render()
    const labels = container.querySelectorAll<HTMLElement>('[data-wbs-toolbar] [data-btn-label]')
    expect(labels.length).toBeGreaterThanOrEqual(4) // 열 숨김·돋보기·완료 숨김·크게·주간보고 계열
    for (const el of labels) {
      expect(el.className).toContain('hidden')
      expect(el.className).toContain('sm:inline')
    }
    // 핵심 버튼들이 실제로 라벨 스팬을 품는다
    for (const sel of [
      '[data-wbs-columns-toggle]',
      '[data-wbs-progress-lens-toggle]',
      '[data-wbs-hide-done-toggle]',
      '[data-wbs-fullscreen-toggle]',
      '[data-wbs-weekly-report]',
    ]) {
      const btn = container.querySelector<HTMLElement>(sel)
      expect(btn, sel).not.toBeNull()
      expect(btn!.querySelector('[data-btn-label]'), sel).not.toBeNull()
    }
  })

  it('툴바 컨트롤 묶음은 모바일 기본 접힘(hidden sm:flex), 토글 버튼으로 펼친다', async () => {
    await render()
    const rest = container.querySelector<HTMLElement>('[data-wbs-toolbar-rest]')
    expect(rest).not.toBeNull()
    expect(rest!.className).toContain('hidden')
    expect(rest!.className).toContain('sm:flex')

    const toggle = container.querySelector<HTMLButtonElement>('[data-wbs-toolbar-toggle]')
    expect(toggle).not.toBeNull()
    expect(toggle!.className).toContain('sm:hidden') // 데스크톱엔 토글 없음
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')

    await act(async () => toggle!.click())
    expect(toggle!.getAttribute('aria-expanded')).toBe('true')
    const opened = container.querySelector<HTMLElement>('[data-wbs-toolbar-rest]')!
    expect(opened.className).not.toContain('hidden')
    expect(opened.className).toContain('flex')
  })

  it('범례는 모바일에서 숨긴다(hidden sm:flex)', async () => {
    await render()
    const legend = container.querySelector<HTMLElement>('[data-wbs-legend]')
    expect(legend).not.toBeNull()
    expect(legend!.className).toContain('hidden')
    expect(legend!.className).toContain('sm:flex')
  })

  it('아이콘만 남아도 접근성 이름은 유지된다 — 라벨 스팬을 품은 버튼은 title 보유', async () => {
    await render()
    const labels = container.querySelectorAll<HTMLElement>('[data-wbs-toolbar] [data-btn-label]')
    for (const el of labels) {
      const btn = el.closest('button')
      expect(btn?.getAttribute('title')).toBeTruthy()
    }
  })
})

describe('PageHero 모바일 숨김', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('히어로는 모바일에서 숨고 md 이상에서만 보인다', async () => {
    await act(async () => root.render(<PageHero title="D-CUBE 프로젝트 WBS · 간트" />))
    const section = container.querySelector('section')
    expect(section).not.toBeNull()
    expect(section!.className).toContain('hidden')
    expect(section!.className).toContain('md:grid')
  })
})
