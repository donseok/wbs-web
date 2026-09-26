// tests/components/agents-design-wait.test.tsx — 설계 완료·선행 대기 좌석(claimed ∧ heartbeat wait_pred, 스펙 2026-09-26 §6.4).
// 좌석 상태는 WAIT 이지만 승인 대기가 아니다 — 승인 대기로 읽히는 곳(레인·메타 줄·결재 버튼·사다리·조르기 대사)이
// 모두 선행 대기로 말해야 한다(표시 = 로깅: 결재할 것이 없는 좌석에 승인 버튼을 띄우지 않는다).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seat, Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/agentWork', () => ({ getReportDecisions: vi.fn(async () => ({ ok: true, decisions: [] })) }))
import { seatMetaLine, seatStateLabel } from '@/components/agents/Seat'
import { LaneBoard } from '@/components/agents/LaneBoard'
import { DetailPanel } from '@/components/agents/DetailPanel'
import { opsFor } from '@/components/agents/seatOps'
import { profilePhaseLabel } from '@/components/agents/RosterBoard'
import { memberChatter } from '@/lib/domain/officeChatter'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const REASON = { kind: 'dependency' as const, label: '선행 대기', text: '설계를 마치고 선행 작업을 기다립니다: X x(현재 ip(작업 중)).' }
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-04-02', name: '주문 상세',
  state: 'WAIT', phase: 'wait_pred', anim: 'waiting', character: 'cat', agent: 'hong/mbp/w1', progress: 10,
  lastSignalAt: new Date(NOW - 3 * 3600_000).toISOString(), heartbeatAt: new Date(NOW - 3 * 3600_000).toISOString(),
  heartbeatPhase: 'wait_pred', note: null, rejected: false, reviewNote: null, waitReason: REASON,
  resumeRequestedAt: null, resumeRequestedHost: null, canManage: true, assigneeMine: true, agentMine: true, agentOwnerName: null,
  designWait: true, ...over,
})
const approval = () => seat({ phase: 'reported', anim: 'idle_coffee', heartbeatPhase: 'reported', waitReason: null, designWait: false, orderId: 'o2', id8: 'o2', code: 'TSK-04-03' })
const REVIEW_REASON = { kind: 'design_review' as const, label: '설계 검토 대기', text: '설계를 마치고 사람의 검토를 기다립니다. 검토 뒤 좌석의 「이어서 시작」을 누르거나 --scope build 로 구현을 이어 갑니다.' }
const reviewSeat = () => seat({
  phase: 'wait_review', heartbeatPhase: 'wait_review', waitReason: REVIEW_REASON, designWait: false, reviewWait: true,
  orderId: 'o3', id8: 'o3', code: 'TSK-04-04',
})
const map = (seats: Seat[]): Seatmap => ({
  floors: [{ id: 'p1', name: 'mes-base', seatCount: seats.length, doneCount: 0, watchers: [], leads: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 0, wait: 0, ready: 0, done: 0 }, seats }] }],
  counters: { active: 0, standby: 0, idle: 0, offline: 0 }, attention: [], fetchedAt: new Date(NOW).toISOString(), scope: 'all',
})
const OPS = { busy: false, note: null, opError: null, onOp: () => {}, onNoteChange: () => {}, onNoteConfirm: () => {}, onNoteCancel: () => {} } as const

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('설계 완료·선행 대기 좌석', () => {
  it('상태 라벨·메타 줄은 선행 대기다(승인 대기 좌석은 종전대로)', () => {
    expect(seatStateLabel(seat())).toBe('선행 대기')
    expect(seatMetaLine(seat(), NOW)).toBe('선행 대기')
    expect(seatStateLabel(approval())).toBe('승인 대기')
    expect(seatMetaLine(approval(), NOW)).toBe('승인 대기')
  })
  it('결재 버튼은 중단뿐 — 승인·반려를 띄우지 않는다', () => {
    expect(opsFor(seat()).map(o => o.spec.kind)).toEqual(['stop'])
    expect(opsFor(approval()).map(o => o.spec.kind)).toEqual(['approve', 'reject'])
  })
  it('상태 레인에서 결재 대기가 아니라 빈자리·완료 레인에 선다', () => {
    act(() => root.render(<LaneBoard map={map([seat(), approval()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-lane-n="wait"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-lane-n="rest"]')?.textContent).toBe('1')
    const rest = host.querySelector('[data-lane="rest"]')!
    expect(rest.textContent).toContain('TSK-04-02')
  })
  it('상세 패널 — 설계 칸을 지나온 칸으로, 대기 사유를 그리고, 결재 버튼은 중단뿐', () => {
    act(() => root.render(<DetailPanel seat={seat()} nowMs={NOW} {...OPS} />))
    const ul = host.querySelector('ul[aria-label="Phase"]')!
    expect([...ul.querySelectorAll('li[data-done="1"]')].map(l => l.textContent?.match(/^[a-z]+/)?.[0])).toEqual(['design'])
    expect(host.querySelector('[data-wait-reason="dependency"]')?.textContent).toContain(REASON.text)
    expect([...host.querySelectorAll('[data-panel-op]')].map(b => (b as HTMLElement).dataset.panelOp)).toEqual(['stop'])
    expect(host.textContent).toContain('선행 대기')
  })
  it('승인을 조르는 한마디를 하지 않는다', () => {
    const d = { seat: seat() } as Parameters<typeof memberChatter>[0]
    expect(Array.from({ length: 30 }, (_, i) => memberChatter(d, NOW + i * 8_000)).every(x => x === null)).toBe(true)
  })
  it('프로필 단계 라벨은 선행 대기', () => {
    expect(profilePhaseLabel(seat())).toBe('선행 대기')
  })
  it('WAIT 좌석 표지는 선행 대기다(SeatMark) — 검토 대기와 구분된다', () => {
    act(() => root.render(<LaneBoard map={map([seat()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    const mark = host.querySelector('[data-mark="waiting"]') as HTMLElement
    expect(mark.getAttribute('data-mark-reason')).toBe('dependency')
    expect(mark.getAttribute('title')).toBe('선행 대기')
  })
})

describe('설계 완료·검토 대기 좌석(claimed ∧ heartbeat wait_review, 스펙 §14.5)', () => {
  it('상태 라벨·메타 줄은 설계 검토 대기다 — 선행 대기·승인 대기와 구분된다', () => {
    expect(seatStateLabel(reviewSeat())).toBe('설계 검토 대기')
    expect(seatMetaLine(reviewSeat(), NOW)).toBe('설계 검토 대기')
  })
  it('결재 버튼은 이어서 시작·중단뿐 — 승인·반려를 띄우지 않는다(스펙 §14.4, wait_pred 와 달리 자동 재개가 없어 재개 버튼이 있다)', () => {
    expect(opsFor(reviewSeat()).map(o => o.spec.kind)).toEqual(['resume', 'stop'])
  })
  it('상태 레인에서 결재 대기가 아니라 빈자리·완료 레인에 선다', () => {
    act(() => root.render(<LaneBoard map={map([reviewSeat(), approval()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-lane-n="wait"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-lane-n="rest"]')?.textContent).toBe('1')
    const rest = host.querySelector('[data-lane="rest"]')!
    expect(rest.textContent).toContain('TSK-04-04')
  })
  it('상세 패널 — 설계 칸을 지나온 칸으로, 대기 사유를 그리고, 결재 버튼은 이어서 시작·중단', () => {
    act(() => root.render(<DetailPanel seat={reviewSeat()} nowMs={NOW} {...OPS} />))
    const ul = host.querySelector('ul[aria-label="Phase"]')!
    expect([...ul.querySelectorAll('li[data-done="1"]')].map(l => l.textContent?.match(/^[a-z]+/)?.[0])).toEqual(['design'])
    expect(host.querySelector('[data-wait-reason="design_review"]')?.textContent).toContain(REVIEW_REASON.text)
    expect([...host.querySelectorAll('[data-panel-op]')].map(b => (b as HTMLElement).dataset.panelOp)).toEqual(['resume', 'stop'])
    expect(host.textContent).toContain('설계 검토 대기')
    // 검토 대기는 선행 문제가 아니다 — 강제 진행 검토 링크(선행 대기 전용)를 달지 않는다.
    expect(host.querySelector('[data-force-entry]')).toBeNull()
  })
  it('WAIT 좌석 표지는 선행 대기가 아니라 설계 검토 대기다(SeatMark)', () => {
    act(() => root.render(<LaneBoard map={map([reviewSeat()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    const mark = host.querySelector('[data-mark="waiting"]') as HTMLElement
    expect(mark.getAttribute('data-mark-reason')).toBe('design_review')
    expect(mark.getAttribute('title')).toBe('설계 검토 대기')
  })
  it('승인을 조르는 한마디를 하지 않는다', () => {
    const d = { seat: reviewSeat() } as Parameters<typeof memberChatter>[0]
    expect(Array.from({ length: 30 }, (_, i) => memberChatter(d, NOW + i * 8_000)).every(x => x === null)).toBe(true)
  })
})
