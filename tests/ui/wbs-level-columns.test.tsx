// @vitest-environment jsdom
// 구분 열 개편(§WBS 시각 개편 2차): 구분(LevelBadge) 열 삭제, 개요 번호(파생) 열 옵션,
// 레벨 N 펼치기, phase 색 스트립(고정 팔레트 순환), 부모 행 중립 음영 일반화.
// 개요 번호는 저장 code 가 아니라 렌더 시점 트리 위치 파생이다(N단 세션 합의) —
// fixture 의 code 에 일부러 어긋난 값을 넣어 파생 계산임을 증명한다.
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

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '9.9.9', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}
// 루트 2개: p1(1) > t1(1.1) > [a1(1.1.1), a2(1.1.2)] / p2(2) — code 는 전부 '9.9.9'(무시돼야 함)
function fixture(): ComputedItem[] {
  const a1 = item({ id: 'a1', name: '설계', depth: 2 })
  const a2 = item({ id: 'a2', name: '구현', depth: 2 })
  const t1 = item({ id: 't1', name: '작업', depth: 1, children: [a1, a2] })
  return [
    item({ id: 'p1', name: '준비', depth: 0, children: [t1] }),
    item({ id: 'p2', name: '마감', depth: 0 }),
  ]
}
function manyRoots(n: number): ComputedItem[] {
  return Array.from({ length: n }, (_, i) => item({ id: `r${i}`, name: `루트${i}`, depth: 0 }))
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }

describe('WBS 구분 열 개편', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function render(items: ComputedItem[], extra: Record<string, unknown> = {}) {
    await act(async () => root.render(
      <WbsGanttSheet items={items} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} {...extra} />,
    ))
  }

  it('구분 열이 더는 렌더되지 않는다(헤더·본문 모두)', async () => {
    await render(fixture())
    expect(container.querySelector('[data-wbs-col="level"]')).toBeNull()
    expect(container.querySelector('.lvl-badge')).toBeNull()
  })

  it('개요 번호 열은 기본 숨김이고 토글 버튼으로 켜면 트리 위치 파생 번호가 나온다(저장 code 무시)', async () => {
    await render(fixture())
    expect(container.querySelector('[data-wbs-col="outline"]')).toBeNull()
    const toggle = container.querySelector<HTMLButtonElement>('button[data-outline-toggle]')
    expect(toggle).not.toBeNull()
    await act(async () => toggle!.click())
    const cellOf = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-wbs-col="outline"]`)?.textContent
    expect(cellOf('p1')).toBe('1')
    expect(cellOf('t1')).toBe('1.1')
    expect(cellOf('a2')).toBe('1.1.2')
    expect(cellOf('p2')).toBe('2') // code '9.9.9' 가 아니라 파생값
  })

  it('initialOutline 이면 개요 번호 열이 처음부터 보인다', async () => {
    await render(fixture(), { initialOutline: true })
    expect(container.querySelector('[data-wbs-col="outline"]')).not.toBeNull()
  })

  it('레벨 버튼: 1 은 루트만, 2 는 2단까지, 최대 레벨은 전부 펼친다', async () => {
    await render(fixture())
    const btn = (lvl: number) => container.querySelector<HTMLButtonElement>(`button[data-level-btn="${lvl}"]`)
    expect(btn(1)).not.toBeNull()
    expect(btn(3)).not.toBeNull() // fixture 최대 3단
    expect(btn(4)).toBeNull()

    await act(async () => btn(1)!.click())
    expect(rowCount(container)).toBe(2) // p1, p2
    await act(async () => btn(2)!.click())
    expect(rowCount(container)).toBe(3) // + t1
    await act(async () => btn(3)!.click())
    expect(rowCount(container)).toBe(5) // 전부
  })

  it('phase 스트립: 같은 루트 서브트리는 같은 색, 다른 루트는 다른 팔레트 색', async () => {
    await render(fixture())
    const band = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-phase-band]`)
    expect(band('p1')).not.toBeNull()
    const color = (id: string) => band(id)!.style.backgroundColor
    expect(color('t1')).toBe(color('p1'))
    expect(color('a2')).toBe(color('p1'))
    expect(color('p2')).not.toBe(color('p1'))
  })

  it('phase 스트립 팔레트는 순환한다 — 팔레트 크기를 넘는 루트는 앞 색을 재사용', async () => {
    await render(manyRoots(9))
    const idx = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-phase-band]`)!.dataset.phaseBand
    expect(idx('r8')).toBe(idx('r0')) // 8색 팔레트 가정: 9번째 루트 = 1번째 색
    expect(idx('r1')).not.toBe(idx('r0'))
  })

  it('레벨별 배경 틴트는 종전 그대로 — depth 0/1 틴트, depth 2+ 는 zebra 계열', async () => {
    await render(fixture())
    const nameCell = (id: string) =>
      container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-wbs-col="name"]`)!.className
    expect(nameCell('p1')).toContain('bg-[#f1f4f9]')
    expect(nameCell('t1')).toContain('bg-[#f8faff]')
    expect(nameCell('a1')).not.toContain('bg-[#f1f4f9]')
    expect(nameCell('a1')).not.toContain('bg-[#f8faff]')
  })

  it('phase 경계(서브트리 마지막 표시 행)에만 가로 구분선이 그어진다', async () => {
    await render(fixture())
    const end = (id: string) =>
      container.querySelector(`[data-row-id="${id}"] [data-phase-end]`)
    // 전개 상태: p1,t1,a1,a2,p2 — p1 서브트리의 끝은 a2, 마지막 phase p2 도 경계.
    expect(end('a2')).not.toBeNull()
    expect(end('p2')).not.toBeNull()
    expect(end('p1')).toBeNull()
    expect(end('t1')).toBeNull()
    expect(end('a1')).toBeNull()
  })

  it('phase 를 접으면 접힌 루트 행 자체가 경계가 된다', async () => {
    await render(fixture())
    const toggle = container.querySelector<HTMLButtonElement>('[data-row-id="p1"] button[aria-expanded]')
    await act(async () => toggle!.click())
    expect(container.querySelector('[data-row-id="p1"] [data-phase-end]')).not.toBeNull()
  })

  it('task(2단) 경계에도 얇은 구분선이 그어진다 — phase 경계와 겹치면 phase 선만', async () => {
    // p1 > (t1 > a1, t2 > a2), p2 — a1 은 t1 서브트리 끝(task 경계), a2 는 p1 끝(phase 경계)
    const a1 = item({ id: 'a1', name: '설계', depth: 2 })
    const a2 = item({ id: 'a2', name: '구현', depth: 2 })
    const t1 = item({ id: 't1', name: '작업1', depth: 1, children: [a1] })
    const t2 = item({ id: 't2', name: '작업2', depth: 1, children: [a2] })
    await render([
      item({ id: 'p1', name: '준비', depth: 0, children: [t1, t2] }),
      item({ id: 'p2', name: '마감', depth: 0 }),
    ])
    const taskEnd = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-task-end]`)
    const phaseEnd = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-phase-end]`)
    expect(taskEnd('a1')).not.toBeNull()
    expect(phaseEnd('a1')).toBeNull()
    expect(phaseEnd('a2')).not.toBeNull()
    expect(taskEnd('a2')).toBeNull() // phase 경계가 우선
    expect(taskEnd('t1')).toBeNull()
    expect(taskEnd('p1')).toBeNull() // phase 헤더 행 밑에는 task 선 없음
  })

  it('레벨 명칭은 열 대신 작업명 툴팁으로 남는다', async () => {
    await render(fixture())
    const nameBtn = container.querySelector<HTMLButtonElement>('[data-row-id="p1"] [data-wbs-col="name"] button[title]')
    expect(nameBtn!.title).toContain('Phase')
  })
})
