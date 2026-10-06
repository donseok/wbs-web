// tests/components/roster-panel-resize.test.tsx — 상세 카드 폭 손잡이·최근 화면 높이 손잡이(2026-10-06).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ResizeHandle } from '@/components/agents/ResizeHandle'
import { useRosterPanelWidth } from '@/components/agents/useRosterPanelWidth'
import { AgentConsolePanel, type ConsoleTarget } from '@/components/agents/AgentConsolePanel'
import { PANEL_WIDTH, SCREEN_HEIGHT } from '@/lib/domain/panelSize'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const KEY = PANEL_WIDTH.storageKey
let host: HTMLDivElement, root: Root
let boardWidth = 2000
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  boardWidth = 2000 // 화면 폭 60%(960) 상한이 보드 상한(1464)보다 먼저 걸리는 넓은 보드
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => boardWidth })
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1600 })
  window.localStorage.clear()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

const q = (sel: string) => host.querySelector(sel) as HTMLElement
const fire = (el: Element, type: string, init: MouseEventInit = {}) =>
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })) })
const key = (el: Element, k: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })

/** 훅 하나를 보드 div 위에서 돌리고 결과를 화면에 노출하는 시험용 틀. */
function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  const p = useRosterPanelWidth(ref)
  return (
    <div ref={ref} data-board>
      <output data-width>{String(p.width)}</output>
      {p.resizable && (
        <ResizeHandle grow="left" value={p.value} min={p.min} max={p.max} step={PANEL_WIDTH.step} label="폭"
          onChange={p.change} onReset={p.reset} />
      )}
    </div>
  )
}
const sep = () => q('[role="separator"]')
const width = () => q('[data-width]').textContent

describe('useRosterPanelWidth', () => {
  it('저장값이 없으면 기본 폭(null)이고 넓은 화면에서 손잡이가 선다', () => {
    act(() => root.render(<Harness />))
    expect(width()).toBe('null')
    expect(sep()).not.toBeNull()
    expect(sep().getAttribute('aria-valuenow')).toBe(String(PANEL_WIDTH.default))
    expect(sep().getAttribute('aria-valuemin')).toBe('280')
    expect(sep().getAttribute('aria-valuemax')).toBe(String(Math.floor(1600 * 0.6)))
    expect(sep().getAttribute('aria-orientation')).toBe('vertical')
  })
  it('저장된 폭을 복원한다', () => {
    window.localStorage.setItem(KEY, '450')
    act(() => root.render(<Harness />))
    expect(width()).toBe('450')
  })
  it('저장값이 상한을 넘으면 상한으로 줄여 보인다(저장값은 그대로)', () => {
    window.localStorage.setItem(KEY, '5000')
    act(() => root.render(<Harness />))
    expect(width()).toBe(String(Math.floor(1600 * 0.6)))
    expect(window.localStorage.getItem(KEY)).toBe('5000')
  })
  it('저장값이 하한 아래면 280 으로 올려 보인다', () => {
    window.localStorage.setItem(KEY, '50')
    act(() => root.render(<Harness />))
    expect(width()).toBe('280')
  })
  it('저장값이 깨져 있으면 기본 폭이다', () => {
    window.localStorage.setItem(KEY, 'abc')
    act(() => root.render(<Harness />))
    expect(width()).toBe('null')
  })
  it('저장소 읽기가 던져도 기본 폭으로 정상 표시한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    act(() => root.render(<Harness />))
    expect(width()).toBe('null')
    expect(sep()).not.toBeNull()
  })
  it('키보드 ← 는 넓히고 → 는 좁히며 확정 때 저장한다', () => {
    act(() => root.render(<Harness />))
    key(sep(), 'ArrowLeft')
    expect(width()).toBe(String(PANEL_WIDTH.default + PANEL_WIDTH.step))
    expect(window.localStorage.getItem(KEY)).toBe(String(PANEL_WIDTH.default + PANEL_WIDTH.step))
    key(sep(), 'ArrowRight'); key(sep(), 'ArrowRight')
    expect(width()).toBe(String(PANEL_WIDTH.default - PANEL_WIDTH.step))
  })
  it('키보드로 하한·상한을 넘지 않고 Home·End 는 양 끝이다', () => {
    act(() => root.render(<Harness />))
    key(sep(), 'Home')
    expect(width()).toBe('280')
    key(sep(), 'ArrowRight')
    expect(width()).toBe('280')
    key(sep(), 'End')
    expect(width()).toBe(String(Math.floor(1600 * 0.6)))
    key(sep(), 'ArrowLeft')
    expect(width()).toBe(String(Math.floor(1600 * 0.6)))
  })
  it('끄는 동안은 저장하지 않고 놓을 때 저장한다(왼쪽으로 끌면 넓어진다)', () => {
    act(() => root.render(<Harness />))
    fire(sep(), 'pointerdown', { clientX: 1000 })
    fire(sep(), 'pointermove', { clientX: 900 })
    expect(width()).toBe(String(PANEL_WIDTH.default + 100))
    expect(window.localStorage.getItem(KEY)).toBeNull()
    fire(sep(), 'pointerup', { clientX: 900 })
    expect(window.localStorage.getItem(KEY)).toBe(String(PANEL_WIDTH.default + 100))
  })
  it('끌어서 상한·하한을 넘지 않는다', () => {
    act(() => root.render(<Harness />))
    fire(sep(), 'pointerdown', { clientX: 1000 })
    fire(sep(), 'pointermove', { clientX: -5000 })
    expect(width()).toBe(String(Math.floor(1600 * 0.6)))
    fire(sep(), 'pointermove', { clientX: 9000 })
    expect(width()).toBe('280')
    fire(sep(), 'pointerup', { clientX: 9000 })
  })
  it('더블클릭하면 기본 폭으로 돌아가고 저장값을 지운다', () => {
    window.localStorage.setItem(KEY, '450')
    act(() => root.render(<Harness />))
    fire(sep(), 'dblclick')
    expect(width()).toBe('null')
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
  it('저장소 쓰기가 던져도 이번 방문에서는 바뀐 폭이 적용된다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    act(() => root.render(<Harness />))
    key(sep(), 'ArrowLeft')
    expect(width()).toBe(String(PANEL_WIDTH.default + PANEL_WIDTH.step))
  })
  it('카드가 아래로 내려가는 좁은 보드에서는 손잡이를 그리지 않는다', () => {
    boardWidth = 700
    act(() => root.render(<Harness />))
    expect(sep()).toBeNull()
  })
  it('내려간 배치의 저장값은 폭에 쓰지 않아도 손잡이는 숨는다', () => {
    boardWidth = 800 // 536 + 280 = 816 미만
    window.localStorage.setItem(KEY, '400')
    act(() => root.render(<Harness />))
    expect(sep()).toBeNull()
  })
  it('기본 폭으로는 내려가는 보드(850)에서도 손잡이는 숨는다 — 종전 배치 유지', () => {
    boardWidth = 850
    act(() => root.render(<Harness />))
    expect(sep()).toBeNull()
  })
  it('보드가 좁아지면 상한이 줄어 카드가 왼쪽 열을 밀어내지 않는다', () => {
    boardWidth = 1000
    window.localStorage.setItem(KEY, '600')
    act(() => root.render(<Harness />))
    expect(width()).toBe(String(1000 - 536))
  })
})

describe('최근 화면 높이 손잡이', () => {
  const target: ConsoleTarget = { kind: 'team_worker', key: 'hong/mbp/w1', label: '팀원 1' }
  const renderPanel = () => act(() => root.render(
    <AgentConsolePanel target={target} nowMs={Date.parse('2026-10-06T09:00:00Z')} canSend canView draft="" onDraftChange={() => {}}
      screen={{ lines: ['$ npm test', 'ok'], capturedAt: '2026-10-06T08:59:30Z' }} />))

  it('처음에는 종전 max-h-80 그대로이고 높이 고정이 없다', () => {
    renderPanel()
    const pre = q('[data-console-screen]')
    expect(pre.className).toContain('max-h-80')
    expect(pre.style.height).toBe('')
  })
  it('손잡이는 가로 구분선이고 키보드 ↓ 로 키운다', () => {
    renderPanel()
    const h = q('[role="separator"]')
    expect(h.getAttribute('aria-orientation')).toBe('horizontal')
    expect(h.getAttribute('aria-valuemin')).toBe(String(SCREEN_HEIGHT.min))
    key(h, 'ArrowDown')
    const pre = q('[data-console-screen]')
    expect(pre.style.height).toBe(`${SCREEN_HEIGHT.default + SCREEN_HEIGHT.step}px`)
    expect(pre.className).not.toContain('max-h-80')
  })
  it('하한 아래로는 줄지 않고 더블클릭하면 종전 상태로 돌아간다', () => {
    renderPanel()
    const h = q('[role="separator"]')
    key(h, 'Home')
    expect(q('[data-console-screen]').style.height).toBe(`${SCREEN_HEIGHT.min}px`)
    key(h, 'ArrowUp')
    expect(q('[data-console-screen]').style.height).toBe(`${SCREEN_HEIGHT.min}px`)
    fire(h, 'dblclick')
    expect(q('[data-console-screen]').className).toContain('max-h-80')
    expect(q('[data-console-screen]').style.height).toBe('')
  })
  it('화면이 없으면 손잡이도 없다', () => {
    act(() => root.render(
      <AgentConsolePanel target={target} nowMs={0} canSend canView draft="" onDraftChange={() => {}} screen={null} />))
    expect(q('[role="separator"]')).toBeNull()
  })
})
