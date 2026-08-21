// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
const queueWbsCollapse = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: (...a: unknown[]) => queueWbsCollapse(...(a as [])) }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}
// phase > task > act(a1, 복수담당 분리 부모=기본 접힘) > sub-act 2개 — 대시보드 액션 큐가 링크하는 리프는 s1/s2
function fixture(): ComputedItem[] {
  const subs = [
    item({ id: 's1', parentId: 'a1', name: '현황 파악 (ERP 주관)', owners: [{ team: 'ERP', kind: 'primary' }], isOwnerSplit: true }),
    item({ id: 's2', parentId: 'a1', name: '현황 파악 (MES 주관)', owners: [{ team: 'MES', kind: 'primary' }], isOwnerSplit: true }),
  ]
  const multi = item({ id: 'a1', name: '현황 파악', owners: [{ team: 'ERP', kind: 'primary' }, { team: 'MES', kind: 'primary' }], children: subs })
  const task = item({ id: 't1', name: '1-1. 착수', children: [multi] })
  return [item({ id: 'p1', name: '1. 준비', children: [task] })]
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }

const scrollIntoView = vi.fn()

describe('WBS focus 점프(대시보드 액션 큐 → WBS 위치 이동)', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queueWbsCollapse.mockClear()
    scrollIntoView.mockClear()
    // reduced-motion 만 참으로 — 전부 true 로 두면 컴팩트 뷰포트 판정까지 걸려 툴바가 걷힌다
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion') }))
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('기본 접힘에 숨은 항목을 focus하면 조상을 펼쳐 행을 드러내고 플래시+스크롤한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />,
    ))
    // 기본 접힘이면 3행(sub 숨김) — focus가 a1을 펼쳐 5행이 된다.
    expect(rowCount(container)).toBe(5)
    const row = container.querySelector<HTMLElement>('[data-row-id="s1"]')
    expect(row).not.toBeNull()
    expect(row!.dataset.flash).toBe('true')
    const gantt = row!.querySelector<HTMLElement>('[data-wbs-col="gantt"]')
    expect(gantt).not.toBeNull()
    expect(gantt!.className).toContain('bg-brand-weak/60')
    expect(gantt!.className).toContain('group-hover:bg-brand-weak')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
  })

  it('focus로 인한 펼침은 접힘 상태 저장(queueWbsCollapse)을 호출하지 않는다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />,
    ))
    expect(queueWbsCollapse).not.toHaveBeenCalled()
  })

  it('focus로 펼쳐진 부모를 사용자가 다시 접으면 행이 숨고, 저장 상태와 같으므로 저장하지 않는다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />,
    ))
    // 접기 전면 허용 후 phase/task 에도 토글이 생겼다 — focus 로 펼쳐진 부모(a1)의 버튼을 정확히 집는다.
    const toggle = container.querySelector<HTMLButtonElement>('[data-row-id="a1"] button[aria-label="wbs.collapse"]')
    expect(toggle).not.toBeNull()
    await act(async () => toggle!.click())
    expect(rowCount(container)).toBe(3)
    expect(queueWbsCollapse).not.toHaveBeenCalled()
  })

  it('트리에 없는 focusId면 펼치지 않되, 조용히 삼키지 않고 토스트로 알린다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="ghost" />,
    ))
    expect(rowCount(container)).toBe(3)
    expect(scrollIntoView).not.toHaveBeenCalled()
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toBe('wbs.focusNotFound')
  })

  it('플래시 행에는 hover 와 구분되는 도착 강조 마커(악센트)가 붙는다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />,
    ))
    const row = container.querySelector<HTMLElement>('[data-row-id="s1"]')
    expect(row!.querySelector('[data-flash-accent]')).not.toBeNull()
  })

  it('점프 후 키보드 포커스가 대상 행으로 이동한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />,
    ))
    const row = container.querySelector<HTMLElement>('[data-row-id="s1"]')
    expect(document.activeElement).toBe(row)
  })

  // 전체 접기/펼치기는 레벨 버튼으로 일반화됐다(2026-08-21 구분 열 개편) — 레벨 1 = 종전
  // 전체 접기, 최대 레벨 = 종전 전체 펼치기. 접기 저장은 이제 루트만이 아니라 대상 레벨
  // 이상의 모든 부모를 담는다(깊은 층이 개별 펼침 때 한꺼번에 쏟아지지 않게).
  it('focus 중 레벨 1 접기는 phase만 남기고 저장한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />,
    ))
    const btn = container.querySelector<HTMLButtonElement>('button[data-level-btn="1"]')
    expect(btn).not.toBeNull()
    await act(async () => btn!.click())
    expect(rowCount(container)).toBe(1)
    expect(queueWbsCollapse).toHaveBeenCalledWith('p1', expect.arrayContaining(['p1']))
  })

  it('레벨 1 은 phase만 남기고, 최대 레벨은 sub-act까지 모두 표시한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />,
    ))
    const levelBtns = [...container.querySelectorAll<HTMLButtonElement>('button[data-level-btn]')]
    expect(levelBtns.length).toBeGreaterThanOrEqual(2)

    await act(async () => levelBtns[0].click())
    expect(rowCount(container)).toBe(1)
    expect(container.querySelector('[data-row-id="p1"]')).not.toBeNull()
    expect(container.querySelector('[data-row-id="t1"]')).toBeNull()

    await act(async () => levelBtns[levelBtns.length - 1].click())
    expect(rowCount(container)).toBe(5)
    expect(container.querySelector('[data-row-id="s1"]')).not.toBeNull()
    expect(container.querySelector('[data-row-id="s2"]')).not.toBeNull()
  })

  it('StrictMode 마운트에서도 focus 진입이 저장을 호출하지 않는다', async () => {
    await act(async () => root.render(
      <StrictMode>
        <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly focusId="s1" />
      </StrictMode>,
    ))
    expect(rowCount(container)).toBe(5)
    expect(queueWbsCollapse).not.toHaveBeenCalled()
  })

  it('플래시가 끝난 뒤 같은 focus 로 재진입하면 다시 점프한다(뒤로가기/재클릭)', async () => {
    vi.useFakeTimers()
    try {
      const props = { items: fixture(), holidays: [] as string[], today: '2026-07-03', actorView: null, projectId: 'p1', readOnly: true }
      await act(async () => root.render(<WbsGanttSheet {...props} focusId="s1" />))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      await act(async () => { vi.advanceTimersByTime(2500) }) // 플래시 해제
      await act(async () => root.render(<WbsGanttSheet {...props} focusId={null} />))
      await act(async () => root.render(<WbsGanttSheet {...props} focusId="s1" />))
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('focusId가 없으면 기존 기본 접힘 그대로다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />,
    ))
    expect(rowCount(container)).toBe(3)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
