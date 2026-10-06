// tests/components/agents-temp-lane.test.tsx — 조정자 킷의 표시 전용 감시자(조정 세션 coord · 임시 팀원) 화면(2026-10-06).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FloorCard } from '@/components/agents/FloorCard'
import { RosterBoard } from '@/components/agents/RosterBoard'
import { OfficeChatterContext } from '@/components/agents/SeatSpeech'
import { watchLabel } from '@/components/agent-hub/HubStatusBar'
import { assembleRoster } from '@/lib/domain/agentRoster'
import type { Floor, Watcher } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-10-06T09:00:00Z')
const watcher = (agent: string, over: Partial<Watcher> = {}): Watcher =>
  ({ agent, host: null, slots: null, busy: null, untilLabel: null, lastSeenAt: new Date(NOW - 120_000).toISOString(), projectId: null, ...over })
const floor = (watchers: Watcher[]): Floor =>
  ({ id: 'p1', name: 'mes-base', seatCount: 0, doneCount: 0, watchers, leads: [], zones: [] })

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const renderFloor = (f: Floor) =>
  act(() => root.render(<FloorCard floor={f} selectedId={null} nowMs={NOW} busyOrderId={null} onSelect={() => {}} onOp={() => {}} />))
const watchText = () => host.querySelector('header span[title]')?.textContent ?? ''

describe('FloorCard — 「감시 중」 문자열', () => {
  it('일반 감시자만 있으면 종전 그대로(agent busy/slots ~until)', () => {
    renderFloor(floor([watcher('hong/mbp/lead', { slots: 3, busy: 1, untilLabel: '18:00' })]))
    expect(watchText()).toBe('감시 중 · hong/mbp/lead 1/3 ~18:00')
  })
  it('조정 세션·임시 팀원은 섞지 않는다', () => {
    renderFloor(floor([
      watcher('hong/mbp/lead', { slots: 3, busy: 1 }),
      watcher('hong/mbp/coord', { slots: 4, busy: 2 }),
      watcher('hong/mbp/coord:r1', { slots: 4, busy: 2 }),
      watcher('hong/mbp/임시:a·x', { untilLabel: '작업 중' }),
    ]))
    expect(watchText()).toBe('감시 중 · hong/mbp/lead 1/3')
  })
  it('보조 감시자뿐이면 「감시 없음」', () => {
    renderFloor(floor([watcher('hong/mbp/coord', { slots: 4, busy: 2 }), watcher('hong/mbp/임시:a·x')]))
    expect(watchText()).toBe('감시 없음')
  })
})

describe('HubStatusBar watchLabel — 일반 감시자 표기 유지', () => {
  it('종전 조합 그대로', () => {
    expect(watchLabel([watcher('hong/mbp/lead', { slots: 3, busy: 1, untilLabel: '18:00' })])).toBe('hong/mbp/lead 1/3 ~18:00')
  })
})

describe('RosterBoard — 임시 팀원·조정 세션 책상', () => {
  const render = (watchers: Watcher[]) =>
    act(() => root.render(<RosterBoard roster={assembleRoster({ floors: [floor(watchers)] })} nowMs={NOW} />))
  const desks = () => [...host.querySelectorAll<HTMLElement>('[data-roster-desk]')]

  it('임시 팀원: 라벨=레인, 한 줄=지시 요약, 배지=상태 라벨(「까지」 없이), 갱신 시각', () => {
    render([watcher('hong/mbp/임시:레인A·로그인 화면 검증', { untilLabel: '머지 중' })])
    const d = desks()[0]
    expect(d.querySelector('b')?.textContent).toBe('레인A')
    expect(d.textContent).toContain('로그인 화면 검증')
    expect(d.textContent).toContain('머지 중')
    expect(d.textContent).not.toContain('까지')
    expect(d.textContent).toContain('갱신')
    expect(d.textContent).not.toContain('신호')
    expect(d.querySelector('[data-nameplate="temp"]')?.textContent).toBe('임시 팀원')
    expect(host.querySelector('[data-roster-host]')?.textContent).toContain('감시자 없음') // 행의 감시자가 아니다
  })
  it('임시 팀원 상태 라벨이 없으면 상태 미상', () => {
    render([watcher('hong/mbp/임시:b·x')])
    expect(desks()[0].textContent).toContain('상태 미상')
  })
  it('coord 는 「팀장(조정)」 책상 — 레인 수·작업 중 수를 보이고 빈 팀원 책상을 만들지 않는다', () => {
    render([watcher('hong/mbp/coord', { slots: 5, busy: 2 })])
    expect(desks()).toHaveLength(1)
    const d = desks()[0]
    expect(d.querySelector('b')?.textContent).toBe('팀장(조정)')
    expect(d.textContent).toContain('레인 5개 · 작업 중 2')
    expect(d.textContent).not.toContain('팀원 5명 배정')
  })
  it('coord:<run-id> 는 팀장(조정) 책상에 회차를 작게 보이고, 접두만 같은 coordinator 는 일반 감시 책상이다', () => {
    render([watcher('hong/mbp/coord:widget-2026-10-05', { slots: 5, busy: 2 })])
    expect(desks()[0].querySelector('b')?.textContent).toBe('팀장(조정)')
    expect(desks()[0].textContent).toContain('회차 widget-2026-10-05')
    render([watcher('hong/mbp/coordinator')])
    expect(desks()[0].querySelector('b')?.textContent).toBe('팀장')
    expect(desks()[0].textContent).not.toContain('회차')
  })
  it('일반 팀장(lead)·단독 감시(poll) 표시는 종전 그대로', () => {
    render([watcher('hong/mbp/lead', { slots: 2, untilLabel: '18:00' }), watcher('hong/mbp/poll')])
    const ds = desks()
    expect(ds.map(d => d.querySelector('b')?.textContent)).toEqual(['팀장', '단독 감시', '팀원 1', '팀원 2'])
    expect(ds[0].textContent).toContain('팀원 2명 배정 · 18:00 까지')
    expect(ds[0].textContent).toContain('신호')
  })
  it('프로필 — 임시 팀원을 고르면 지시와 마지막 갱신이 보인다', () => {
    render([watcher('hong/mbp/임시:레인A·로그인 · 검증', { untilLabel: '작업 중' })])
    const p = host.querySelector('[data-roster-profile]')!
    expect(p.querySelector('h2')?.textContent).toBe('레인A')
    expect(p.querySelector('[data-roster-temp]')?.textContent).toContain('로그인 · 검증')
    expect(p.textContent).toContain('마지막 갱신')
  })
  it('답 대기 — 조정 팀장 책상은 상태 글자가 「답 대기」 점멸 배지가 되고 사장님 재촉 말풍선이 뜬다', () => {
    render([watcher('hong/mbp/coord:abcd1234', { slots: 3, busy: 1, untilLabel: '답 대기' })])
    const d = desks()[0]
    expect(d.querySelector('[data-answer-wait]')?.textContent).toBe('답 대기')
    expect(d.querySelector('[data-chat-bubble]')?.textContent).toContain('사장님')
    expect(d.textContent).not.toContain('조정 중')
    // 프로필(첫 책상이 골라진다)의 상태 칩도 같은 배지다.
    expect(host.querySelector('[data-roster-profile] [data-answer-wait]')?.textContent).toBe('답 대기')
  })
  it('답 대기 — 임시 팀원 책상은 팀장님께 확인을 부탁하고 같은 배지를 단다', () => {
    render([watcher('hong/mbp/임시:eng·노드 엔진', { untilLabel: '답 대기' })])
    const d = desks()[0]
    expect(d.querySelector('[data-answer-wait]')?.textContent).toBe('답 대기')
    expect(d.querySelector('[data-chat-bubble]')?.textContent).toContain('팀장님')
  })
  it('답 대기가 아니면 배지가 없고, 일반 팀장은 until 이 「답 대기」여도 배지를 달지 않는다', () => {
    render([watcher('hong/mbp/coord:abcd1234', { slots: 3, busy: 1, untilLabel: '조정 중' })])
    expect(desks()[0].querySelector('[data-answer-wait]')).toBeNull()
    expect(desks()[0].textContent).toContain('조정 중')
    render([watcher('hong/mbp/lead', { slots: 1, untilLabel: '답 대기' })])
    expect(host.querySelector('[data-answer-wait]')).toBeNull()
  })
  it('잡담을 꺼도 답 대기 말풍선은 뜨고, 다른 조정 말풍선은 사라진다', () => {
    const off = (watchers: Watcher[]) => act(() => root.render(
      <OfficeChatterContext.Provider value={false}>
        <RosterBoard roster={assembleRoster({ floors: [floor(watchers)] })} nowMs={NOW} />
      </OfficeChatterContext.Provider>))
    off([watcher('hong/mbp/coord:abcd1234', { slots: 3, busy: 1, untilLabel: '답 대기' })])
    expect(desks()[0].querySelector('[data-chat-bubble]')?.textContent).toContain('사장님')
    off([watcher('hong/mbp/coord:abcd1234', { slots: 3, busy: 1, untilLabel: '조정 중' })])
    expect(desks()[0].querySelector('[data-chat-bubble]')).toBeNull()
  })
})
