// tests/components/agents-phase-badge.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PhaseBadge, seatPhaseKey } from '@/components/agents/PhaseBadge'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('PhaseBadge — 캐릭터 머리 위 단계 말풍선(2026-09-18)', () => {
  it('일하는 좌석은 단계 이름과 네 점 중 현재 위치까지 채운다', () => {
    act(() => root.render(<PhaseBadge seat={{ state: 'ACTIVE', phase: 'verify' }} />))
    const b = host.querySelector('[data-phase-badge="verify"]')
    expect(b?.textContent).toContain('검증')
    expect([...host.querySelectorAll('[data-phase-dot]')].map(d => d.getAttribute('data-phase-dot'))).toEqual(['on', 'on', 'on', 'off'])
    expect(b?.getAttribute('title')).toBe('검증 단계 (3/4)')
  })
  it('결정 대기는 순서 밖이라 점 없이 말풍선만 단다', () => {
    act(() => root.render(<PhaseBadge seat={{ state: 'BLOCKED', phase: 'blocked' }} />))
    expect(host.querySelector('[data-phase-badge="blocked"]')?.textContent).toContain('결정 대기')
    expect(host.querySelector('[data-phase-dot]')).toBeNull()
  })
  it('신호가 끊긴 좌석은 마지막 보고 단계로 흐리게 보인다', () => {
    act(() => root.render(<PhaseBadge seat={{ state: 'STALE', phase: 'build' }} size="chip" />))
    expect(host.querySelector('[data-phase-badge="build"]')?.getAttribute('title')).toContain('마지막 보고')
  })
  it('빈자리·승인 대기·완료 좌석엔 달지 않는다', () => {
    expect(seatPhaseKey({ state: 'READY', phase: 'design' })).toBeNull()
    expect(seatPhaseKey({ state: 'WAIT', phase: 'reported' })).toBeNull()
    expect(seatPhaseKey({ state: 'DONE', phase: 'reported' })).toBeNull()
    expect(seatPhaseKey({ state: 'REJECTED', phase: 'rejected' })).toBe('rejected')
    expect(seatPhaseKey({ state: 'REJECTED', phase: 'build' })).toBe('build')
  })
  it('머지 충돌은 승인 대기·완료 좌석에도 말풍선을 달고, 순서 밖 상태라 점은 그리지 않는다', () => {
    expect(seatPhaseKey({ state: 'WAIT', phase: 'merge_conflict' })).toBe('merge_conflict')
    expect(seatPhaseKey({ state: 'DONE', phase: 'merge_conflict' })).toBe('merge_conflict')
    act(() => root.render(<PhaseBadge seat={{ state: 'WAIT', phase: 'merge_conflict' }} />))
    const b = host.querySelector('[data-phase-badge="merge_conflict"]')
    expect(b?.textContent).toContain('머지 충돌')
    expect(b?.getAttribute('title')).toBe('머지 충돌')
    expect(host.querySelector('[data-phase-dot]')).toBeNull()
  })
  it('반려(REJECTED)·일하는 좌석에 남은 merge_conflict 는 머지 충돌 말풍선을 달지 않는다(2026-09-23 리뷰)', () => {
    expect(seatPhaseKey({ state: 'REJECTED', phase: 'merge_conflict' })).toBe('rejected')
    expect(seatPhaseKey({ state: 'ACTIVE', phase: 'merge_conflict' })).toBeNull()
  })
})
