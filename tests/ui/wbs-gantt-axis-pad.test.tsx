// @vitest-environment jsdom
// 간트 날짜 축 여백: 축이 계획 최솟값~최댓값에서 뚝 끊겨 마지막 주에 마일스톤 라벨이
// 잘리고 "끊긴 느낌"이 든다(2026-08-21 피드백). 달력 주(월~일) 기준 이전 주 월요일부터
// 다음 주 일요일까지 보여준다.
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
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

describe('간트 날짜 축 여백', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('축은 시작날짜(07-01)에서 시작하고 끝은 다음 주 일요일(07-19)까지 이어진다', async () => {
    // 완료 항목으로 고정 — 진행 0% 항목은 forecast(지연 전망)가 축 끝을 더 늘려 주 수가 달라진다.
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1', depth: 0, actualPct: 100, rolledActualPct: 100, status: 'done' })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    // 시작주는 시작날짜로 시작(피드백) — 앞쪽 패딩 없음: W01 부제 = 7/1, 6월 주 없음.
    expect(container.textContent).toContain('W017/1W')
    expect(container.textContent).not.toContain('6/2')
    // 끝 여백: 07-01~07-19 = 19일 = W03 까지, W04 없음.
    expect(container.textContent).toContain('W03')
    expect(container.textContent).not.toContain('W04')
  })

  function setSlider(input: HTMLInputElement, value: number) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('간트 배율 슬라이더로 일 폭(12~48px)을 조정하고 계정에 저장한다', async () => {
    const { queueUiPref } = await import('@/lib/prefs/debouncedSave')
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1', depth: 0 })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    const region = container.firstElementChild as HTMLElement
    expect(region.style.getPropertyValue('--gantt-day')).toBe('24px')
    const slider = container.querySelector<HTMLInputElement>('input[data-gantt-zoom]')!
    expect(slider).not.toBeNull()
    expect(slider.min).toBe('12')
    expect(slider.max).toBe('48')

    await act(async () => setSlider(slider, 48))
    expect(region.style.getPropertyValue('--gantt-day')).toBe('48px')
    expect(vi.mocked(queueUiPref)).toHaveBeenCalledWith({ wbsGanttScale: 48 })

    await act(async () => setSlider(slider, 12))
    expect(region.style.getPropertyValue('--gantt-day')).toBe('12px')
  })

  it('저장된 initialGanttScale 로 시작하고 범위 밖 저장값은 clamp 된다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1', depth: 0 })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} initialGanttScale={40} />,
    ))
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--gantt-day')).toBe('40px')
    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1', depth: 0 })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} initialGanttScale={999} />,
    ))
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--gantt-day')).toBe('48px')
  })
})
