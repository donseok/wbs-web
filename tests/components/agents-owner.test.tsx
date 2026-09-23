// tests/components/agents-owner.test.tsx — 내 에이전트·다른 계정 에이전트 구분(2026-09-19): 세 보기 모두 같은 규칙.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SeatCard } from '@/components/agents/Seat'
import { LaneBoard } from '@/components/agents/LaneBoard'
import { RosterBoard } from '@/components/agents/RosterBoard'
import { ownerLabel } from '@/components/agents/OwnerTag'
import { assembleRoster } from '@/lib/domain/agentRoster'
import type { Seat, Seatmap, Watcher } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-09-14T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1',
  code: 'TSK-04-02', name: '주문 상세', state: 'ACTIVE', phase: 'build', anim: 'typing', character: 'cat',
  agent: 'hong/mbp/w1', progress: 60, lastSignalAt: new Date(NOW - 42_000).toISOString(),
  heartbeatAt: new Date(NOW - 42_000).toISOString(), heartbeatPhase: 'build', note: null, rejected: false, reviewNote: null,
  waitReason: null, resumeRequestedAt: null, resumeRequestedHost: null, canManage: false, assigneeMine: false, agentMine: false, agentOwnerName: null, ...over,
})
const watcher = (agent: string, over: Partial<Watcher> = {}): Watcher =>
  ({ agent, host: null, slots: 1, busy: 1, untilLabel: null, lastSeenAt: new Date(NOW - 5000).toISOString(), projectId: null, ...over })
const map = (seats: Seat[], watchers: Watcher[] = []): Seatmap => ({
  floors: [{ id: 'p1', name: 'mes-base', seatCount: seats.length, doneCount: 0, watchers, leads: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 0, wait: 0, ready: 0, done: 0 }, seats }] }],
  counters: { active: 0, standby: 0, idle: 0, offline: 0 }, attention: [], fetchedAt: new Date(NOW).toISOString(), scope: 'all',
})

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ownerLabel', () => {
  it('내 것 · 이름 있는 남의 것 · 이름 모르는 남의 것 · 에이전트 없는 좌석', () => {
    expect(ownerLabel(seat({ agentMine: true }))).toEqual({ kind: 'mine', text: '내 에이전트' })
    expect(ownerLabel(seat({ agentOwnerName: '홍길동' }))).toEqual({ kind: 'other', text: '홍길동의 에이전트' })
    expect(ownerLabel(seat())).toEqual({ kind: 'other', text: '다른 계정' })
    expect(ownerLabel(seat({ state: 'READY', agent: null }))).toBeNull()
    // READY 는 에이전트 이름이 남아 있어도(재위임으로 풀린 주문) 빈자리다.
    expect(ownerLabel(seat({ state: 'READY', agentMine: true }))).toBeNull()
    expect(ownerLabel(seat({ agent: null, agentMine: true }))).toBeNull()
  })
})

describe('평면도 좌석(SeatCard)', () => {
  const render = (s: Seat) => act(() => root.render(<SeatCard seat={s} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
  it('내 에이전트는 책상에 data-owner="mine"(브랜드 테두리)과 "내 에이전트" 명찰', () => {
    render(seat({ agentMine: true }))
    const desk = host.querySelector('[data-state]') as HTMLElement
    expect(desk.dataset.owner).toBe('mine')
    expect(host.querySelector('[data-owner-tag="mine"]')?.textContent).toBe('내 에이전트')
  })
  it('다른 계정은 테두리 강조 없이(data-owner="other") 소유자 이름 명찰', () => {
    render(seat({ agentOwnerName: '홍길동' }))
    expect((host.querySelector('[data-state]') as HTMLElement).dataset.owner).toBe('other')
    expect(host.querySelector('[data-owner-tag="other"]')?.textContent).toBe('홍길동의 에이전트')
  })
  it('빈자리에는 아무 표시도 없다', () => {
    render(seat({ state: 'READY', agent: null, anim: 'empty' }))
    expect((host.querySelector('[data-state]') as HTMLElement).dataset.owner).toBeUndefined()
    expect(host.querySelector('[data-owner-tag]')).toBeNull()
  })
  it('반려 표식·선택 표식과 같이 선다 — 내 것이어도 data-rejected·data-selected 가 그대로 붙는다', () => {
    act(() => root.render(<SeatCard seat={seat({ agentMine: true, state: 'REJECTED', rejected: true })} side="right" selected nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    const desk = host.querySelector('[data-state]') as HTMLElement
    expect(desk.dataset.owner).toBe('mine')
    expect(desk.dataset.rejected).toBe('1')
    expect(desk.dataset.selected).toBe('1')
  })
})

describe('상태 레인(LaneBoard)', () => {
  it('카드마다 같은 규칙 — 내 것은 data-owner="mine"·명찰, 남의 것은 이름, 빈자리는 없음', () => {
    const m = map([
      seat({ orderId: 'a', agentMine: true }),
      seat({ orderId: 'b', agentOwnerName: '홍길동', state: 'WAIT' }),
      seat({ orderId: 'c', state: 'READY', agent: null, anim: 'empty' }),
    ])
    act(() => root.render(<LaneBoard map={m} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    const cards = [...host.querySelectorAll('[data-state]')] as HTMLElement[]
    const by = (st: string) => cards.find(c => c.dataset.state === st)!
    expect(by('ACTIVE').dataset.owner).toBe('mine')
    expect(by('ACTIVE').querySelector('[data-owner-tag]')?.textContent).toBe('내 에이전트')
    expect(by('WAIT').dataset.owner).toBe('other')
    expect(by('WAIT').querySelector('[data-owner-tag]')?.textContent).toBe('홍길동의 에이전트')
    expect(by('READY').dataset.owner).toBeUndefined()
    expect(by('READY').querySelector('[data-owner-tag]')).toBeNull()
  })
})

describe('에이전트 보기(RosterBoard)', () => {
  const render = (m: Seatmap) => act(() => root.render(<RosterBoard roster={assembleRoster(m)} nowMs={NOW} />))
  it('내 팀이 맨 앞이고, 내 팀장·팀원 책상은 data-owner="mine"·명찰, 남의 것은 이름 명찰, 빈자리는 없음', () => {
    render(map(
      [seat({ orderId: 'a', agent: 'hong/alpha/w1', agentOwnerName: '홍길동' }), seat({ orderId: 'b', agent: 'me/zeta/w1', agentMine: true })],
      [watcher('hong/alpha/lead', { ownerName: '홍길동', mine: false, slots: 2 }), watcher('me/zeta/lead', { mine: true })],
    ))
    const hosts = [...host.querySelectorAll('[data-roster-host]')].map(h => h.getAttribute('data-roster-host'))
    expect(hosts).toEqual(['me/zeta', 'hong/alpha'])
    const mineHost = host.querySelector('[data-roster-host="me/zeta"]')!
    const mineDesks = [...mineHost.querySelectorAll('[data-roster-desk]')] as HTMLElement[]
    expect(mineDesks.map(d => d.dataset.owner)).toEqual(['mine', 'mine'])
    expect(mineDesks.map(d => d.querySelector('[data-owner-tag]')?.textContent)).toEqual(['내 에이전트', '내 에이전트'])
    const otherHost = host.querySelector('[data-roster-host="hong/alpha"]')!
    const other = [...otherHost.querySelectorAll('[data-roster-desk]')] as HTMLElement[]
    // 팀장 · 팀원 1 · 빈자리(팀원 2)
    expect(other.map(d => d.dataset.owner)).toEqual(['other', 'other', undefined])
    expect(other[0].querySelector('[data-owner-tag]')?.textContent).toBe('홍길동의 에이전트')
    expect(other[1].querySelector('[data-owner-tag]')?.textContent).toBe('홍길동의 에이전트')
    expect(other[2].querySelector('[data-owner-tag]')).toBeNull()
    // 테두리 색은 선택 몫, 내 것은 바깥 브랜드 링 — 고른 내 책상은 선택 링을 브랜드 링 바깥에 둔다.
    const [lead, member] = mineDesks
    expect(member.getAttribute('aria-pressed')).toBe('true')
    expect(member.className).toContain('ring-offset-brand')
    expect(lead.className).toContain('shadow-[0_0_0_2px_var(--color-brand)]')
    expect(lead.className).not.toContain('border-brand')
    for (const d of other) expect(d.className).not.toContain('var(--color-brand)')
  })
  it('팀(작업 PC 행)에도 표시가 간다 — 내 팀은 브랜드 바탕·링과 「내 팀」 명찰, 남의 팀은 이름 명찰(2026-09-20)', () => {
    render(map(
      [seat({ orderId: 'a', agent: 'hong/alpha/w1', agentOwnerName: '홍길동' }), seat({ orderId: 'b', agent: 'me/zeta/w1', agentMine: true })],
      [watcher('hong/alpha/lead', { ownerName: '홍길동', mine: false, slots: 2 }), watcher('me/zeta/lead', { mine: true })],
    ))
    const mineHost = host.querySelector('[data-roster-host="me/zeta"]') as HTMLElement
    expect(mineHost.dataset.owner).toBe('mine')
    expect(mineHost.className).toContain('bg-brand-weak')
    expect(mineHost.className).toContain('shadow-[0_0_0_2px_var(--color-brand)]')
    expect(mineHost.querySelector('header [data-owner-tag]')?.textContent).toBe('내 팀')
    const otherHost = host.querySelector('[data-roster-host="hong/alpha"]') as HTMLElement
    expect(otherHost.dataset.owner).toBe('other')
    expect(otherHost.className).toContain('bg-surface')
    expect(otherHost.className).not.toContain('var(--color-brand)')
    expect(otherHost.querySelector('header [data-owner-tag]')?.textContent).toBe('홍길동의 팀')
  })
  it('흐리게 하지 않는다 — 남의 책상에 opacity 클래스가 붙지 않는다', () => {
    render(map([seat({ agentOwnerName: '홍길동' })]))
    const desk = host.querySelector('[data-roster-desk]') as HTMLElement
    expect(desk.className).not.toMatch(/opacity/)
    expect(desk.querySelector('[class*="opacity"]')).toBeNull()
  })
})

describe('에이전트 보기 책상 카드의 WBS 바로가기(2026-09-24)', () => {
  it('일하는 책상에는 focus·open 딥링크가 붙고, 카드 버튼 밖에 있어 중첩되지 않는다 — 빈자리에는 없다', () => {
    act(() => root.render(<RosterBoard roster={assembleRoster(map(
      [seat({ agent: 'hong/alpha/w1', itemId: 'i9' })],
      [watcher('hong/alpha/lead', { slots: 2 })],
    ))} nowMs={NOW} />))
    const links = [...host.querySelectorAll('[data-roster-desk-wbs]')] as HTMLAnchorElement[]
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/p/p1/wbs?focus=i9&open=1'])
    expect(links[0].textContent).toBe('WBS 에서 열기')
    expect(links[0].closest('button')).toBeNull()
  })
  it('프로필 카드에도 같은 딥링크의 「WBS 에서 열기」 버튼이 있다', () => {
    act(() => root.render(<RosterBoard roster={assembleRoster(map(
      [seat({ agent: 'hong/alpha/w1', itemId: 'i9' })],
      [watcher('hong/alpha/lead', { slots: 2 })],
    ))} nowMs={NOW} />))
    const a = host.querySelector('[data-roster-profile] [data-roster-wbs-link]') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/p/p1/wbs?focus=i9&open=1')
    expect(a.textContent).toContain('WBS 에서 열기')
  })
})
