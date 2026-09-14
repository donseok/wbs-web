// tests/components/agents-detail-panel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seat } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { DetailPanel } from '@/components/agents/DetailPanel'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-01', name: '목록',
  state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat_dev', agent: 'hong/mbp/w1', progress: 60,
  lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: new Date(NOW - 5000).toISOString(), heartbeatPhase: 'build',
  note: null, rejected: false, reviewNote: null, waitReason: null, ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('DetailPanel — ladderPhase', () => {
  it('refactor 는 verify 칸을 data-now 로 표시하고 design·build 는 지나온 칸(data-done)', () => {
    act(() => root.render(<DetailPanel seat={seat({ phase: 'refactor', progress: 90 })} floorName="mes-base" zoneLabel="주문 관리" nowMs={NOW} />))
    const ul = host.querySelector('ul[aria-label="Phase"]')!
    const nowLis = ul.querySelectorAll('li[data-now="1"]')
    expect(nowLis.length).toBe(1)
    expect(nowLis[0].textContent).toMatch(/^verify/)
    const doneLis = ul.querySelectorAll('li[data-done="1"]')
    expect(doneLis.length).toBe(2)
    expect([...doneLis].map(l => l.textContent?.match(/^[a-z]+/)?.[0])).toEqual(['design', 'build'])
  })
  it('build 는 회귀 없이 그대로 build 칸을 data-now 로 표시한다', () => {
    act(() => root.render(<DetailPanel seat={seat({ phase: 'build', progress: 60 })} floorName="mes-base" zoneLabel="주문 관리" nowMs={NOW} />))
    const ul = host.querySelector('ul[aria-label="Phase"]')!
    const nowLis = ul.querySelectorAll('li[data-now="1"]')
    expect(nowLis.length).toBe(1)
    expect(nowLis[0].textContent).toMatch(/^build/)
  })
})

describe('DetailPanel — 착수 대기 사유', () => {
  const READY = { state: 'READY' as const, phase: 'design' as const, anim: 'empty' as const, agent: null, progress: 0, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null }
  it('READY 이고 waitReason 이 있으면 상태 배지 아래 라벨과 전문을 그린다', () => {
    const wr = { kind: 'dependency' as const, label: '선행 대기', text: '선행 작업이 아직 끝나지 않았습니다: TSK-04-01 목록(현재 fp(기능 계획)).' }
    act(() => root.render(<DetailPanel seat={seat({ ...READY, waitReason: wr })} floorName="mes-base" zoneLabel="주문 관리" nowMs={NOW} />))
    const p = host.querySelector('[data-wait-reason="dependency"]')!
    expect(p).not.toBeNull()
    expect(p.textContent).toContain('선행 대기')
    expect(p.textContent).toContain(wr.text)
  })
  it('waitReason 이 없거나 READY 가 아니면 그리지 않는다', () => {
    act(() => root.render(<DetailPanel seat={seat({ ...READY, waitReason: null })} floorName="f" zoneLabel="z" nowMs={NOW} />))
    expect(host.querySelector('[data-wait-reason]')).toBeNull()
    act(() => root.render(<DetailPanel seat={seat({ waitReason: { kind: 'pickup', label: '착수 대기', text: 'x' } })} floorName="f" zoneLabel="z" nowMs={NOW} />))
    expect(host.querySelector('[data-wait-reason]')).toBeNull()
  })
})
