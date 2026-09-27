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
import { SeatCard, seatMetaLine, seatStateLabel } from '@/components/agents/Seat'
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
const REVIEW_REASON = { kind: 'design_review' as const, label: '설계 검토 대기', text: '설계를 마치고 사람의 검토를 기다립니다. agent 브랜치의 design.md 를 검토하고(고쳤으면 push 한 뒤) WBS 작업 패널이나 에이전트 허브에서 「설계 승인」을 누르면 팀장이 다음 확인 주기에 구현을 시작합니다.' }
const REVIEW_DESIGN = { row: 1, label: '설계 검토 대기', note: null, hint: 'agent 브랜치의 <TASKS>/<TSK>/design.md 를 검토하고, 고쳤으면 push 한 뒤 「설계 승인」을 누르세요.' }
const reviewSeat = () => seat({
  phase: 'wait_review', heartbeatPhase: 'wait_review', waitReason: REVIEW_REASON, designWait: false, reviewWait: true, design: REVIEW_DESIGN,
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

describe('설계 검토 대기 좌석(claimed ∧ 설계 상태 review, 설계 상태 스펙 3절 1행)', () => {
  it('상태 라벨·메타 줄은 설계 검토 대기다 — 선행 대기·승인 대기와 구분된다', () => {
    expect(seatStateLabel(reviewSeat())).toBe('설계 검토 대기')
    expect(seatMetaLine(reviewSeat(), NOW)).toBe('설계 검토 대기')
  })
  it('결재 버튼은 중단뿐 — 「이어서 시작」은 review 에서 숨기고(설계 상태 스펙 12절 Y10), 승인·반려도 띄우지 않는다', () => {
    expect(opsFor(reviewSeat()).map(o => o.spec.kind)).toEqual(['stop'])
  })
  it('상태 레인에서 결재 대기가 아니라 빈자리·완료 레인에 선다', () => {
    act(() => root.render(<LaneBoard map={map([reviewSeat(), approval()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-lane-n="wait"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-lane-n="rest"]')?.textContent).toBe('1')
    const rest = host.querySelector('[data-lane="rest"]')!
    expect(rest.textContent).toContain('TSK-04-04')
  })
  it('상세 패널 — 설계 칸을 지나온 칸으로, 설계 문구와 안내를 그리고(같은 뜻의 대기 사유는 겹쳐 그리지 않는다), 결재 버튼은 중단뿐', () => {
    act(() => root.render(<DetailPanel seat={reviewSeat()} nowMs={NOW} {...OPS} />))
    const ul = host.querySelector('ul[aria-label="Phase"]')!
    expect([...ul.querySelectorAll('li[data-done="1"]')].map(l => l.textContent?.match(/^[a-z]+/)?.[0])).toEqual(['design'])
    const detail = host.querySelector('[data-seat-design-detail="1"]') as HTMLElement
    expect(detail.textContent).toContain('설계 검토 대기')
    expect(detail.textContent).toContain('「설계 승인」')
    expect(host.querySelector('[data-wait-reason="design_review"]')).toBeNull()
    expect([...host.querySelectorAll('[data-panel-op]')].map(b => (b as HTMLElement).dataset.panelOp)).toEqual(['stop'])
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

describe('설계 문구(설계 상태 스펙 3절 화면 판정) — 좌석 카드·레인·상세', () => {
  const accepted = () => seat({
    state: 'WAIT', phase: 'wait_review', anim: 'waiting', heartbeatPhase: 'wait_review', waitReason: null, designWait: false, reviewWait: false, buildWait: true,
    design: { row: 3, label: '구현 대기(설계 승인됨)', note: null, hint: '팀장이 떠 있으면 다음 TICK(기본 30분) 안에 구현을 시작합니다.' },
    orderId: 'o5', id8: 'o5', code: 'TSK-04-05',
  })
  it('설계 문구가 있으면 상태 라벨·메타 줄이 그 문구다 — 없으면 지금 문구 그대로', () => {
    expect(seatStateLabel(accepted())).toBe('구현 대기(설계 승인됨)')
    expect(seatMetaLine(accepted(), NOW)).toBe('구현 대기(설계 승인됨)')
    expect(seatMetaLine(approval(), NOW)).toBe('승인 대기')
  })
  it('평면도 좌석·레인 카드의 메타 줄에 data-seat-design-label(행 번호)을 단다', () => {
    act(() => root.render(<LaneBoard map={map([accepted(), approval()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelectorAll('[data-seat-design-label]')).toHaveLength(1)
    expect(host.querySelector('[data-seat-design-label="3"]')?.textContent).toBe('구현 대기(설계 승인됨)')
    act(() => root.render(<SeatCard seat={accepted()} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-seat-design-label="3"]')?.textContent).toBe('구현 대기(설계 승인됨)')
  })
  it('구현 대기(buildWait)는 결재 대기가 아니다 — 「이어서 시작」·중단(Y10), 빈자리·완료 레인, 구현 대기 표지, 승인을 조르지 않는다', () => {
    expect(opsFor(accepted()).map(o => o.spec.kind)).toEqual(['resume', 'stop'])
    expect(seatStateLabel({ ...accepted(), design: null })).toBe('구현 대기')
    act(() => root.render(<LaneBoard map={map([accepted(), approval()])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-lane-n="wait"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-lane="rest"]')?.textContent).toContain('TSK-04-05')
    const mark = host.querySelector('[data-lane="rest"] [data-mark="waiting"]') as HTMLElement
    expect(mark.getAttribute('data-mark-reason')).toBe('build_wait')
    expect(mark.getAttribute('title')).toBe('구현 대기')
    const d = { seat: accepted() } as Parameters<typeof memberChatter>[0]
    expect(Array.from({ length: 30 }, (_, i) => memberChatter(d, NOW + i * 8_000)).every(x => x === null)).toBe(true)
  })
  it('상세 패널 — 설계 문구·되돌림 사유·안내를 그리고, 빈자리 사유는 선행 대기(dependency)일 때만 함께 그린다', () => {
    const human = seat({
      state: 'READY', phase: 'design', anim: 'empty', agent: null, heartbeatPhase: null, designWait: false,
      waitReason: { kind: 'pickup', label: '착수 대기', text: '집어갈 수 있는 에이전트가 있습니다.' },
      design: { row: 6, label: '사람 설계 대기', note: '빠진 절: 테스트 계획', hint: '개발 브랜치의 <TASKS>/<TSK>/design.md 에 필수 5개 절을 모두 쓰고 push 한 뒤 「설계 확정」을 누르세요.' },
    })
    act(() => root.render(<DetailPanel seat={human} nowMs={NOW} {...OPS} />))
    const d = host.querySelector('[data-seat-design-detail="6"]') as HTMLElement
    expect(d.textContent).toContain('사람 설계 대기')
    expect(d.textContent).toContain('빠진 절: 테스트 계획')
    expect(d.textContent).toContain('「설계 확정」')
    expect(host.querySelector('[data-wait-reason]')).toBeNull() // 착수 대기는 사람 설계 대기와 어긋난다 — 그리지 않는다
    const dep = seat({
      state: 'READY', phase: 'design', anim: 'waiting', agent: null, heartbeatPhase: null, designWait: false,
      waitReason: { kind: 'dependency', label: '선행 대기', text: '선행 작업이 아직 끝나지 않았습니다: X x.' },
      design: { row: 11, label: '선행 대기', note: null, hint: null },
    })
    act(() => root.render(<DetailPanel seat={dep} nowMs={NOW} {...OPS} />))
    expect(host.querySelector('[data-seat-design-detail="11"]')).not.toBeNull()
    expect(host.querySelector('[data-wait-reason="dependency"]')?.textContent).toContain('선행 작업이 아직')
  })
})
