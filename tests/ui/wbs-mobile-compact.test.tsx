// @vitest-environment jsdom
// 모바일/컴팩트 압축(2026-08-21): 좁은 폭(세로 폰)뿐 아니라 낮은 높이(가로 폰)도 컴팩트로
// 판정해야 한다 — sm(640px) 폭 기준만 쓰면 가로 폰이 데스크톱 취급돼 히어로·툴바·범례가
// 화면을 다 먹는다. 판정은 useCompactViewport(JS matchMedia) 하나로 통일하고, CSS 반응형
// display 유틸과 섞지 않는다(unlayered 안전망이 layered 변형을 이기기 때문).
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
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

/** matchMedia 스텁 — matches 고정값. 가로 폰(폭 800·높이 400)도 COMPACT_MQ OR 조건으로 걸린다. */
function stubMq(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

describe('WBS 컴팩트 압축', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  async function render() {
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1' })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
  }

  it('툴바는 flex-wrap — 2열 그리드 강제 배치를 쓰지 않는다', async () => {
    await render()
    const toolbar = container.querySelector<HTMLElement>('[data-wbs-toolbar]')
    expect(toolbar).not.toBeNull()
    expect(toolbar!.className).toContain('flex-wrap')
    expect(toolbar!.className).not.toContain('grid-cols')
  })

  it('컴팩트: 버튼 글자 라벨이 사라지고 아이콘만 남되 title 은 유지된다', async () => {
    stubMq(true)
    await render()
    expect(container.querySelectorAll('[data-wbs-toolbar] [data-btn-label]')).toHaveLength(0)
    for (const sel of ['[data-wbs-progress-lens-toggle]', '[data-wbs-hide-done-toggle]', '[data-wbs-fullscreen-toggle]', '[data-wbs-weekly-report]']) {
      const btn = container.querySelector<HTMLElement>(sel)
      expect(btn, sel).not.toBeNull()
      expect(btn!.getAttribute('title'), sel).toBeTruthy()
    }
  })

  it('일반: 버튼 글자 라벨이 전부 보인다', async () => {
    stubMq(false)
    await render()
    const labels = container.querySelectorAll<HTMLElement>('[data-wbs-toolbar] [data-btn-label]')
    expect(labels.length).toBeGreaterThanOrEqual(4)
    for (const sel of ['[data-wbs-columns-toggle]', '[data-wbs-progress-lens-toggle]', '[data-wbs-hide-done-toggle]', '[data-wbs-fullscreen-toggle]', '[data-wbs-weekly-report]']) {
      expect(container.querySelector(`${sel} [data-btn-label]`), sel).not.toBeNull()
    }
  })

  it('컴팩트: 툴바 컨트롤 묶음은 기본 접힘, 토글 버튼으로 펼친다', async () => {
    stubMq(true)
    await render()
    const rest = container.querySelector<HTMLElement>('[data-wbs-toolbar-rest]')
    expect(rest).not.toBeNull()
    expect(rest!.className).toContain('hidden')

    const toggle = container.querySelector<HTMLButtonElement>('[data-wbs-toolbar-toggle]')
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')

    await act(async () => toggle!.click())
    expect(toggle!.getAttribute('aria-expanded')).toBe('true')
    const opened = container.querySelector<HTMLElement>('[data-wbs-toolbar-rest]')!
    expect(opened.className).not.toContain('hidden')
    expect(opened.className).toContain('flex')
  })

  it('일반: 툴바는 항상 펼침이고 토글 버튼이 없다', async () => {
    stubMq(false)
    await render()
    const rest = container.querySelector<HTMLElement>('[data-wbs-toolbar-rest]')!
    expect(rest.className).toContain('flex')
    expect(rest.className).not.toContain('hidden')
    expect(container.querySelector('[data-wbs-toolbar-toggle]')).toBeNull()
  })

  it('컴팩트: 작업명 열을 줄이고 계획 열을 기본 숨겨 캘린더가 화면에 들어온다', async () => {
    stubMq(true)
    await render()
    const nameHead = container.querySelector<HTMLElement>('[data-wbs-col="name"][data-wbs-col-kind="header"]')
    expect(nameHead).not.toBeNull()
    expect(nameHead!.style.width).toBe('176px') // 데스크톱 360px → 컴팩트 176px
    expect(container.querySelector('[data-wbs-col="deliverable"][data-wbs-col-kind="header"]')).toBeNull()
  })

  it('일반: 종전 360px 그대로, 계획 열도 보인다', async () => {
    stubMq(false)
    await render()
    const nameHead = container.querySelector<HTMLElement>('[data-wbs-col="name"][data-wbs-col-kind="header"]')
    expect(nameHead!.style.width).toBe('360px')
    expect(container.querySelector('[data-wbs-col="deliverable"][data-wbs-col-kind="header"]')).not.toBeNull()
  })

  // matchMedia 는 mount effect 에서 1회만 읽으므로 스텁별로 테스트를 분리한다(재렌더로는 안 바뀜)
  it('컴팩트: 범례를 렌더하지 않는다', async () => {
    stubMq(true)
    await render()
    expect(container.querySelector('[data-wbs-legend]')).toBeNull()
  })

  it('일반: 범례를 렌더한다', async () => {
    stubMq(false)
    await render()
    expect(container.querySelector('[data-wbs-legend]')).not.toBeNull()
  })
})

describe('히어로 컴팩트 숨김', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  it('PageHero 는 CSS 기준선으로 md 미만에서 숨는다(SSR 플래시 방지)', async () => {
    await act(async () => root.render(<PageHero title="D-CUBE 프로젝트 WBS · 간트" />))
    const section = container.querySelector('section')
    expect(section).not.toBeNull()
    expect(section!.className).toContain('hidden')
    expect(section!.className).toContain('md:grid')
  })

  it('ProjectPageShell 은 컴팩트에서 히어로 래퍼 자체를 렌더하지 않는다(가로 폰 포함)', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    await act(async () => root.render(
      <ProjectPageShell hero={<PageHero title="타이틀" />}><div>본문</div></ProjectPageShell>,
    ))
    expect(container.querySelector('section')).toBeNull()
    expect(container.textContent).toContain('본문')
  })

  it('ProjectPageShell 은 일반 뷰포트에서 히어로를 렌더한다', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    await act(async () => root.render(
      <ProjectPageShell hero={<PageHero title="타이틀" />}><div>본문</div></ProjectPageShell>,
    ))
    expect(container.querySelector('section')).not.toBeNull()
  })
})
