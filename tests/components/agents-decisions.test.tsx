// @vitest-environment jsdom
// 오피스의 결정 칩과 상세 패널 목록(과제 C, 스펙 §7.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seat, Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getReportDecisions = vi.fn()
vi.mock('@/app/actions/agentWork', () => ({ getReportDecisions: (...a: unknown[]) => getReportDecisions(...(a as [])) }))

import { SeatCard } from '@/components/agents/Seat'
import { LaneBoard } from '@/components/agents/LaneBoard'
import { DetailPanel } from '@/components/agents/DetailPanel'

const NOW = Date.parse('2026-09-23T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: '11111111-1111-4111-8111-111111111111', id8: '11111111', projectId: 'p1', itemId: 'i1',
  code: 'TSK-04-02', name: '주문 상세', state: 'WAIT', phase: 'reported', anim: 'idle_look', character: 'cat',
  agent: 'hong/mbp/w1', progress: 100, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null,
  note: null, rejected: false, reviewNote: null, resumeRequestedAt: null, resumeRequestedHost: null, waitReason: null,
  canManage: true, assigneeMine: false, agentMine: false, agentOwnerName: null, ...over,
})
const map = (seats: Seat[]): Seatmap => ({
  floors: [{ id: 'p1', name: 'mes-base', seatCount: seats.length, doneCount: 0, watchers: [], leads: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 0, wait: 0, ready: 0, done: 0 }, seats }] }],
  counters: { active: 0, standby: 0, idle: 0, offline: 0 }, attention: [], fetchedAt: new Date(NOW).toISOString(), scope: 'all',
})
const OPS = { busy: false, note: null, opError: null, onOp: () => {}, onNoteChange: () => {}, onNoteConfirm: () => {}, onNoteCancel: () => {} } as const
const DEC = { key: 'D1', question: '넣는가?', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향' }

let host: HTMLDivElement, root: Root
beforeEach(() => { getReportDecisions.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('결정 칩', () => {
  it('좌석 책상에 결정 N 칩 — 1 이상일 때만', () => {
    act(() => root.render(<SeatCard seat={seat({ decisionCount: 2 })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-decision-chip="2"]')!.textContent).toBe('결정 2')
    for (const c of [0, null, undefined]) {
      act(() => root.render(<SeatCard seat={seat({ decisionCount: c })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
      expect(host.querySelector('[data-decision-chip]')).toBeNull()
    }
  })
  it('상태 레인 결재 대기 카드에도 칩', () => {
    act(() => root.render(<LaneBoard map={map([seat({ decisionCount: 3 })])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    const card = host.querySelector('[data-lane="wait"]')!
    expect(card.querySelector('[data-decision-chip="3"]')).not.toBeNull()
  })
})

describe('상세 패널 결정 목록', () => {
  it('결재 대기 + 결정 ≥ 1 이면 열릴 때 한 번 읽어 목록을 그린다', async () => {
    getReportDecisions.mockResolvedValue({ ok: true, decisions: [DEC] })
    await act(async () => { root.render(<DetailPanel seat={seat({ decisionCount: 1 })} nowMs={NOW} {...OPS} />) })
    expect(getReportDecisions).toHaveBeenCalledTimes(1)
    expect(getReportDecisions).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(host.querySelector('[data-decision="D1"]')).not.toBeNull()
    // 기본은 접혀 있다(2026-09-25 사용자 요청).
    const fold = host.querySelector('[data-decisions="ok"]')!.closest('details')!
    expect(fold).not.toBeNull()
    expect(fold.hasAttribute('open')).toBe(false)
  })
  it('조회 실패는 빈 목록이 아니라 오류 문구와 재시도 — 재시도하면 다시 읽는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getReportDecisions.mockResolvedValueOnce({ ok: false, error: 'db down' }).mockResolvedValueOnce({ ok: true, decisions: [DEC] })
    await act(async () => { root.render(<DetailPanel seat={seat({ decisionCount: 1 })} nowMs={NOW} {...OPS} />) })
    expect(host.querySelector('[data-seat-decisions-error]')!.textContent).toContain('결정 목록을 불러오지 못했습니다')
    expect(host.querySelector('[data-decisions]')).toBeNull()
    await act(async () => { (host.querySelector('[data-seat-decisions-retry]') as HTMLButtonElement).click() })
    expect(getReportDecisions).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[data-decision="D1"]')).not.toBeNull()
  })
  it('결정이 없거나 결재 대기가 아니면 읽지 않는다', async () => {
    await act(async () => { root.render(<DetailPanel seat={seat({ decisionCount: 0 })} nowMs={NOW} {...OPS} />) })
    await act(async () => { root.render(<DetailPanel seat={seat({ state: 'ACTIVE', decisionCount: 2 })} nowMs={NOW} {...OPS} />) })
    expect(getReportDecisions).not.toHaveBeenCalled()
  })
})
