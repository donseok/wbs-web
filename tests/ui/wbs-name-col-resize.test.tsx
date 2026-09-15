// @vitest-environment jsdom
// 작업명 컬럼 폭 드래그 조절(§항목3, 2026-09-15): 고정 360px(narrow 176px)이던 작업명 열을
// 사용자가 드래그로 조절하고 localStorage('wbs.nameColWidth')에 저장·복원한다.
// 핸들은 RowDetailPanel 패널 폭 핸들과 같은 lifecycle — 초기 렌더는 반응형 기본값과 동일(하이드레이션
// 파리티), 저장값은 마운트 후 적용. matchMedia 를 스텁하지 않으면 narrow=false(데스크톱=360px) —
// narrow 쪽 기본값(176px) 회귀는 tests/ui/wbs-mobile-compact.test.tsx 가 이미 담당한다.
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

const STORAGE_KEY = 'wbs.nameColWidth'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

describe('WBS 작업명 컬럼 폭 드래그', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.removeItem(STORAGE_KEY) // 다음 테스트 파일(wbs-font-scale 의 layoutSnapshot 등)로 새지 않게
  })

  async function render() {
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'a1' })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
  }

  const nameHead = () => container.querySelector<HTMLElement>('[data-wbs-col="name"][data-wbs-col-kind="header"]')!
  const handle = () => container.querySelector<HTMLElement>('[data-wbs-name-col-resize]')
  const sheet = () => container.querySelector<HTMLElement>('[data-wbs-gantt-sheet]')!

  it('핸들은 항상 렌더되고 cursor-col-resize 를 갖는다(hidden 상태 변형 아님)', async () => {
    await render()
    const h = handle()
    expect(h).not.toBeNull()
    expect(h!.className).toContain('cursor-col-resize')
    expect(h!.hidden).toBe(false)
  })

  it('저장값이 없으면 기본 360px', async () => {
    await render()
    expect(nameHead().style.width).toBe('360px')
  })

  it('마운트 전 저장된 값이 있으면 마운트 후 그 값으로 복원된다', async () => {
    window.localStorage.setItem(STORAGE_KEY, '500')
    await render()
    expect(nameHead().style.width).toBe('500px')
  })

  it('저장값이 clamp 범위 밖(min 120 미만)이면 무시하고 기본값을 쓴다', async () => {
    window.localStorage.setItem(STORAGE_KEY, '50')
    await render()
    expect(nameHead().style.width).toBe('360px')
  })

  it('저장값이 숫자가 아니면 무시하고 기본값을 쓴다', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-a-number')
    await render()
    expect(nameHead().style.width).toBe('360px')
  })

  it('드래그하면 실시간으로 폭이 바뀌고, 놓으면 localStorage 에 저장된다', async () => {
    await render()
    const before = sheet().style.getPropertyValue('--wbs-left-w')
    const h = handle()!
    await act(async () => {
      h.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 300 }))
    })
    await act(async () => {
      h.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 })) // +100
    })
    expect(nameHead().style.width).toBe('460px') // 360(기본) + 100
    const after = sheet().style.getPropertyValue('--wbs-left-w')
    expect(after).not.toBe(before) // 동결/오버레이 앵커(LEFT_W)가 폭 변화를 따라간다

    await act(async () => {
      h.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('460')
  })

  it('드래그로 최대(720px)를 넘기면 clamp 된다', async () => {
    await render()
    const h = handle()!
    await act(async () => {
      h.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0 }))
    })
    await act(async () => {
      h.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5000 }))
    })
    expect(nameHead().style.width).toBe('720px')
    await act(async () => {
      h.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('720')
  })

  it('저장된 폭은 재마운트(새로고침 시뮬레이션) 후에도 복원된다', async () => {
    await render()
    const h = handle()!
    await act(async () => { h.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0 })) })
    await act(async () => { h.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 140 })) })
    await act(async () => { h.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })) })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('500')

    // 같은 프로젝트를 새로 마운트(다른 root) — SSR 첫 페인트는 기본값, 마운트 후 저장값 적용.
    await act(async () => root.unmount())
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await render()
    expect(nameHead().style.width).toBe('500px')
  })
})
