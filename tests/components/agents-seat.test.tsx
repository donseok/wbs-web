// tests/components/agents-seat.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sprite } from '@/components/agents/Sprite'
import { SeatCard, seatMetaLine, STATE_LABEL } from '@/components/agents/Seat'
import type { Seat } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-09-14T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: '11111111-1111-4111-8111-111111111111', id8: '11111111', projectId: 'p1', itemId: 'i1',
  code: 'TSK-04-02', name: '주문 상세', state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat_dev',
  agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 42_000).toISOString(),
  heartbeatAt: new Date(NOW - 42_000).toISOString(), heartbeatPhase: 'build', note: null, rejected: false, reviewNote: null, ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Sprite', () => {
  it('캐릭터·동작으로 배경 이미지와 프레임 수 클래스를 정한다', () => {
    act(() => root.render(<Sprite character="cat_dev" anim="idle_coffee" />))
    const el = host.querySelector('[data-sprite]') as HTMLElement
    expect(el.style.backgroundImage).toContain('/sprites/cat_dev/idle_coffee.png')
    expect(el.dataset.frames).toBe('6')
    expect(el.style.getPropertyValue('--frames')).toBe('6')
    expect(el.style.getPropertyValue('--fps')).toBe('4')
  })
  it('empty 는 공용 빈 의자 1프레임', () => {
    act(() => root.render(<Sprite character="cat_dev" anim="empty" />))
    const el = host.querySelector('[data-sprite]') as HTMLElement
    expect(el.style.backgroundImage).toContain('/sprites/empty.png')
    expect(el.dataset.frames).toBe('1')
  })
  it('reduceMotion 이면 정지 표식', () => {
    act(() => root.render(<Sprite character="cat_dev" anim="typing" reduceMotion />))
    expect((host.querySelector('[data-sprite]') as HTMLElement).dataset.still).toBe('1')
  })
})

describe('SeatCard', () => {
  it('책상 버튼에 코드·이름·메타·상태가 있고 클릭하면 orderId 로 선택된다', () => {
    let picked = ''
    act(() => root.render(<SeatCard seat={seat()} side="left" selected={false} nowMs={NOW} onSelect={id => { picked = id }} />))
    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.textContent).toContain('TSK-04-02')
    expect(btn.textContent).toContain('주문 상세')
    expect(btn.textContent).toContain('hong/mbp/w1 · 42초 전')
    expect(btn.dataset.state).toBe('ACTIVE')
    act(() => btn.click())
    expect(picked).toBe('11111111-1111-4111-8111-111111111111')
  })
  it('BLOCKED 는 ? 표식과 질문, STALE 은 !, OFFLINE 은 끊김', () => {
    act(() => root.render(<SeatCard seat={seat({ state: 'BLOCKED', note: '어느 DB?' })} side="right" selected nowMs={NOW} onSelect={() => {}} />))
    expect(host.textContent).toContain('?'); expect(host.textContent).toContain('어느 DB?')
    act(() => root.render(<SeatCard seat={seat({ state: 'STALE' })} side="right" selected={false} nowMs={NOW} onSelect={() => {}} />))
    expect(host.querySelector('[data-flag]')?.textContent).toBe('!')
    act(() => root.render(<SeatCard seat={seat({ state: 'OFFLINE' })} side="right" selected={false} nowMs={NOW} onSelect={() => {}} />))
    expect(host.querySelector('[data-flag]')?.textContent).toBe('끊김')
  })
})

describe('seatMetaLine · STATE_LABEL', () => {
  it('상태별 문구', () => {
    expect(seatMetaLine(seat(), NOW)).toBe('hong/mbp/w1 · 42초 전')
    expect(seatMetaLine(seat({ state: 'STALE' }), NOW)).toBe('hong/mbp/w1 · 무응답 42초 전')
    expect(seatMetaLine(seat({ state: 'OFFLINE', phase: 'build' }), NOW)).toBe('build 에서 끊김 · 42초 전')
    expect(seatMetaLine(seat({ state: 'WAIT' }), NOW)).toBe('승인 대기')
    expect(seatMetaLine(seat({ state: 'READY', agent: null }), NOW)).toBe('미착수')
    expect(seatMetaLine(seat({ state: 'BLOCKED' }), NOW)).toBe('hong/mbp/w1 · 결정 대기')
    expect(STATE_LABEL.REJECTED).toBe('반려 · 재작업')
  })
})
