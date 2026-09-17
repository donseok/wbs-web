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
  state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat', agent: 'hong/mbp/w1', progress: 60,
  lastSignalAt: new Date(NOW - 5000).toISOString(), heartbeatAt: new Date(NOW - 5000).toISOString(), heartbeatPhase: 'build',
  note: null, rejected: false, reviewNote: null, waitReason: null, canManage: true, assigneeMine: false, ...over,
})

/** 결재 배선은 SeatmapView 가 쥔다 — 사다리·사유 표시 시험에서는 아무 것도 하지 않는 기본값을 넘긴다. */
const OPS = { busy: false, note: null, opError: null, onOp: () => {}, onNoteChange: () => {}, onNoteConfirm: () => {}, onNoteCancel: () => {} } as const

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('DetailPanel — ladderPhase', () => {
  it('refactor 는 verify 칸을 data-now 로 표시하고 design·build 는 지나온 칸(data-done)', () => {
    act(() => root.render(<DetailPanel seat={seat({ phase: 'refactor', progress: 90 })} floorName="mes-base" zoneLabel="주문 관리" nowMs={NOW} {...OPS} />))
    const ul = host.querySelector('ul[aria-label="Phase"]')!
    const nowLis = ul.querySelectorAll('li[data-now="1"]')
    expect(nowLis.length).toBe(1)
    expect(nowLis[0].textContent).toMatch(/^verify/)
    const doneLis = ul.querySelectorAll('li[data-done="1"]')
    expect(doneLis.length).toBe(2)
    expect([...doneLis].map(l => l.textContent?.match(/^[a-z]+/)?.[0])).toEqual(['design', 'build'])
  })
  it('build 는 회귀 없이 그대로 build 칸을 data-now 로 표시한다', () => {
    act(() => root.render(<DetailPanel seat={seat({ phase: 'build', progress: 60 })} floorName="mes-base" zoneLabel="주문 관리" nowMs={NOW} {...OPS} />))
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
    act(() => root.render(<DetailPanel seat={seat({ ...READY, waitReason: wr })} floorName="mes-base" zoneLabel="주문 관리" nowMs={NOW} {...OPS} />))
    const p = host.querySelector('[data-wait-reason="dependency"]')!
    expect(p).not.toBeNull()
    expect(p.textContent).toContain('선행 대기')
    expect(p.textContent).toContain(wr.text)
  })
  it('waitReason 이 없거나 READY 가 아니면 그리지 않는다', () => {
    act(() => root.render(<DetailPanel seat={seat({ ...READY, waitReason: null })} floorName="f" zoneLabel="z" nowMs={NOW} {...OPS} />))
    expect(host.querySelector('[data-wait-reason]')).toBeNull()
    act(() => root.render(<DetailPanel seat={seat({ waitReason: { kind: 'pickup', label: '착수 대기', text: 'x' } })} floorName="f" zoneLabel="z" nowMs={NOW} {...OPS} />))
    expect(host.querySelector('[data-wait-reason]')).toBeNull()
  })
})

describe('DetailPanel — 좌석 결재', () => {
  it('상태에 맞는 op 버튼을 그리고, 사유가 필요한 op 는 입력과 확정 버튼을 낸다', () => {
    const calls: string[] = []
    act(() => root.render(<DetailPanel seat={seat({ state: 'WAIT' })} floorName="f" zoneLabel="z" nowMs={NOW}
      {...OPS} onOp={(_s, k) => { calls.push(k) }} />))
    expect([...host.querySelectorAll('[data-panel-op]')].map(b => (b as HTMLElement).dataset.panelOp)).toEqual(['approve', 'reject'])
    act(() => (host.querySelector('[data-panel-op="reject"]') as HTMLButtonElement).click())
    expect(calls).toEqual(['reject'])
    // 사유가 비면 확정이 잠기고, 글이 들어오면 열린다
    act(() => root.render(<DetailPanel seat={seat({ state: 'WAIT' })} floorName="f" zoneLabel="z" nowMs={NOW}
      {...OPS} note={{ orderId: 'o1', kind: 'reject', text: '' }} />))
    expect((host.querySelector('[data-op-confirm]') as HTMLButtonElement).disabled).toBe(true)
    act(() => root.render(<DetailPanel seat={seat({ state: 'WAIT' })} floorName="f" zoneLabel="z" nowMs={NOW}
      {...OPS} note={{ orderId: 'o1', kind: 'reject', text: '테스트가 빠졌습니다' }} />))
    expect((host.querySelector('[data-op-confirm]') as HTMLButtonElement).disabled).toBe(false)
    expect((host.querySelector('[data-op-note]') as HTMLTextAreaElement).value).toBe('테스트가 빠졌습니다')
  })
  it('다른 좌석의 사유 초안은 이 좌석에 그리지 않는다', () => {
    act(() => root.render(<DetailPanel seat={seat({ state: 'WAIT' })} floorName="f" zoneLabel="z" nowMs={NOW}
      {...OPS} note={{ orderId: 'o9', kind: 'reject', text: 'x' }} />))
    expect(host.querySelector('[data-op-note]')).toBeNull()
  })
  it('빈자리에는 할 것이 없다고 적고, 처리 실패는 그대로 보여 준다', () => {
    act(() => root.render(<DetailPanel seat={seat({ state: 'READY' })} floorName="f" zoneLabel="z" nowMs={NOW}
      {...OPS} opError="상태가 바뀌어 회수하지 못했습니다. 다시 시도하세요." />))
    expect(host.querySelectorAll('[data-panel-op]')).toHaveLength(0)
    expect(host.textContent).toContain('이 좌석에는 처리할 것이 없습니다')
    expect(host.querySelector('[data-op-error]')?.textContent).toContain('상태가 바뀌어')
  })
  it('머지 완료 좌석에서는 승인 취소와 재작업 요청이 뜬다', () => {
    act(() => root.render(<DetailPanel seat={seat({ state: 'DONE' })} floorName="f" zoneLabel="z" nowMs={NOW} {...OPS} />))
    expect([...host.querySelectorAll('[data-panel-op]')].map(b => (b as HTMLElement).dataset.panelOp)).toEqual(['unapprove', 'rework'])
  })
})
