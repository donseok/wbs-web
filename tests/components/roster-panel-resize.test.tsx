// tests/components/roster-panel-resize.test.tsx — 상세 카드 폭 손잡이·최근 화면 높이 손잡이(2026-10-06).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ResizeHandle } from '@/components/agents/ResizeHandle'
import { useRosterPanelWidth } from '@/components/agents/useRosterPanelWidth'
import { AgentConsolePanel, type ConsoleTarget } from '@/components/agents/AgentConsolePanel'
import { RosterBoard } from '@/components/agents/RosterBoard'
import { assembleRoster } from '@/lib/domain/agentRoster'
import type { Floor, Watcher } from '@/lib/domain/seatmap'
import { PANEL_WIDTH, SCREEN_HEIGHT } from '@/lib/domain/panelSize'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const KEY = PANEL_WIDTH.storageKey
let host: HTMLDivElement, root: Root
let boardWidth = 2000
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  boardWidth = 2000 // 화면 폭 60%(960) 상한이 보드 상한(1464)보다 먼저 걸리는 넓은 보드
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: boardWidth, height: 0 }) as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return parseInt(this.style.height) || 200 } }) // 인라인 높이가 있으면 그 값, 없으면 내용 높이 200
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
  it('움직임 없이 클릭만 하면 폭을 저장하지 않는다', () => {
    act(() => root.render(<Harness />))
    fire(sep(), 'pointerdown', { clientX: 1000 })
    fire(sep(), 'pointerup', { clientX: 1000 })
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(width()).toBe('null')
  })
  it('끌다가 취소(pointercancel)돼도 지금까지의 폭을 확정한다', () => {
    act(() => root.render(<Harness />))
    fire(sep(), 'pointerdown', { clientX: 1000 })
    fire(sep(), 'pointermove', { clientX: 950 })
    fire(sep(), 'pointercancel')
    expect(window.localStorage.getItem(KEY)).toBe(String(PANEL_WIDTH.default + 50))
  })
  it('보드 폭이 소수여도 내림으로 재서 상한이 카드를 떨어뜨리지 않는다', () => {
    boardWidth = 1000.6
    window.localStorage.setItem(KEY, '900')
    act(() => root.render(<Harness />))
    expect(width()).toBe(String(1000 - 536))
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
  it('손잡이는 가로 구분선이고 실제 높이를 aria-valuenow 로 알린다', () => {
    renderPanel()
    const h = q('[role="separator"]')
    expect(h.getAttribute('aria-orientation')).toBe('horizontal')
    expect(h.getAttribute('aria-valuemin')).toBe(String(SCREEN_HEIGHT.min))
    expect(h.getAttribute('aria-valuenow')).toBe('200')
  })
  it('키보드 ↓ 는 실제 높이(200)에서 키우고 max-h-80 을 푼다', () => {
    renderPanel()
    key(q('[role="separator"]'), 'ArrowDown')
    const pre = q('[data-console-screen]')
    expect(pre.style.height).toBe(`${200 + SCREEN_HEIGHT.step}px`)
    expect(pre.className).not.toContain('max-h-80')
  })
  it('키보드 ↑ 는 기본값(320)이 아니라 실제 높이에서 줄인다', () => {
    renderPanel()
    key(q('[role="separator"]'), 'ArrowUp')
    expect(q('[data-console-screen]').style.height).toBe(`${200 - SCREEN_HEIGHT.step}px`)
  })
  it('움직임 없이 클릭만 하면 높이를 고정하지 않는다', () => {
    renderPanel()
    const h = q('[role="separator"]')
    fire(h, 'pointerdown', { clientY: 500 })
    fire(h, 'pointerup', { clientY: 500 })
    expect(q('[data-console-screen]').className).toContain('max-h-80')
    expect(q('[data-console-screen]').style.height).toBe('')
  })
  it('아래로 끌면 시작 높이에서 그만큼 커진다', () => {
    renderPanel()
    const h = q('[role="separator"]')
    fire(h, 'pointerdown', { clientY: 500 })
    fire(h, 'pointermove', { clientY: 560 })
    fire(h, 'pointerup', { clientY: 560 })
    expect(q('[data-console-screen]').style.height).toBe('260px')
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

describe('RosterBoard — 상세 카드 연결', () => {
  const NOW = Date.parse('2026-10-06T09:00:00Z')
  const watcher: Watcher = { agent: 'hong/mbp/임시:레인A·검증', host: null, slots: null, busy: null, untilLabel: '작업 중',
    lastSeenAt: new Date(NOW - 120_000).toISOString(), projectId: null }
  const floor: Floor = { id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, watchers: [watcher], leads: [], zones: [] }
  const renderBoard = () => act(() => root.render(<RosterBoard roster={assembleRoster({ floors: [floor] })} nowMs={NOW} />))
  const aside = () => q('[data-roster-profile]')

  it('저장값이 없으면 카드는 종전 그대로(인라인 폭 없음)이고 넓은 보드에서 손잡이가 카드 안에 있다', () => {
    renderBoard()
    expect(aside().style.flexBasis).toBe('')
    expect(aside().querySelector('[role="separator"]')).not.toBeNull()
  })
  it('저장된 폭이 카드 flex-basis 로 들어간다', () => {
    window.localStorage.setItem(KEY, '460')
    renderBoard()
    expect(aside().style.flexBasis).toBe('460px')
  })
  it('손잡이를 키보드로 움직이면 카드 폭이 바뀐다', () => {
    renderBoard()
    key(aside().querySelector('[role="separator"]')!, 'ArrowLeft')
    expect(aside().style.flexBasis).toBe(`${PANEL_WIDTH.default + PANEL_WIDTH.step}px`)
  })
  it('내려가는 좁은 보드에서는 손잡이가 없고 인라인 폭도 쓰지 않는다', () => {
    boardWidth = 600
    window.localStorage.setItem(KEY, '460')
    renderBoard()
    expect(aside().querySelector('[role="separator"]')).toBeNull()
  })
})
