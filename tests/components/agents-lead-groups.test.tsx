// tests/components/agents-lead-groups.test.tsx — 에이전트 보기: PC 바운더리 안에 팀장마다 바운더리 하나(2026-10-06 지시 office-group-1).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RosterBoard } from '@/components/agents/RosterBoard'
import { OfficeChatterContext } from '@/components/agents/SeatSpeech'
import { assembleRoster } from '@/lib/domain/agentRoster'
import { parseLaneSummary } from '@/lib/domain/laneSummary'
import type { Floor, Seat, Watcher } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-10-06T09:00:00Z')
const HOST = 'jongik-jang/mac'
const seat = (orderId: string, agent: string | null, state: Seat['state']): Seat =>
  ({ orderId, agent, state, code: orderId, name: orderId, progress: 10, itemId: null, projectId: 'p1' } as unknown as Seat)
const watcher = (agent: string, over: Partial<Watcher> = {}): Watcher =>
  ({ agent, host: null, slots: null, busy: null, untilLabel: null, lastSeenAt: new Date(NOW - 120_000).toISOString(), projectId: null, ...over })
const floor = (seats: Seat[], watchers: Watcher[]): Floor =>
  ({ id: 'p1', name: 'mes-base', seatCount: seats.length, doneCount: 0, watchers, leads: [], zones: [{ key: 'z', code: 'Z', name: 'Z', seats, summary: { work: 0, wait: 0, ready: 0, done: 0 } }] })
const summary = (lane: string, lead?: string) => {
  const r = parseLaneSummary({ v: 1, lane, state: 'active', items_done: 0, items_total: 1, ...(lead ? { lead } : {}) })
  if (!r.ok || !r.value) throw new Error('summary')
  return r.value
}
const coord = (sid: string, lanes: number, over: Partial<Watcher> = {}) => watcher(`${HOST}/coord:${sid}`, { slots: lanes, busy: lanes, untilLabel: '조정 중', ...over })
const lane = (name: string, lead?: string, over: Partial<Watcher> = {}) =>
  watcher(`${HOST}/임시:${name}·${name} 작업`, { untilLabel: '작업 중', summary: summary(name, lead), ...over })

let el: HTMLDivElement, root: Root
beforeEach(() => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el) })
afterEach(() => { act(() => root.unmount()); el.remove() })

const render = (watchers: Watcher[], seats: Seat[] = []) => {
  const roster = assembleRoster({ floors: [floor(seats, watchers)] })
  act(() => root.render(<OfficeChatterContext.Provider value={false}><RosterBoard roster={roster} nowMs={NOW} /></OfficeChatterContext.Provider>))
}
const groups = () => [...el.querySelectorAll<HTMLElement>('[data-roster-group]')]
const deskSlots = (g: HTMLElement) => [...g.querySelectorAll<HTMLElement>('[data-roster-desk]')].map(d => d.getAttribute('data-roster-desk'))
const headText = (g: HTMLElement) => g.querySelector('header')?.textContent ?? ''

describe('RosterBoard — 팀장마다 바운더리 하나', () => {
  it('팀장 2명이면 묶음도 2개, 머리에 팀장 이름·세션·팀원 수, 팀장 카드가 맨 앞이고 팀원은 자기 팀장 안에만', () => {
    render([
      coord('0f8a8f92', 2), coord('cf0e8ce6', 0),
      lane('grid-bare', '0f8a8f92'), lane('kit', '0f8a8f92'),
    ])
    const g = groups()
    expect(g).toHaveLength(2)
    expect(g.map(x => x.getAttribute('data-roster-group'))).toEqual(['coord', 'coord'])
    expect(headText(g[0])).toContain('팀장(조정)')
    expect(headText(g[0])).toContain('세션 0f8a8f92')
    expect(headText(g[0])).toContain('팀원 2명')
    expect(deskSlots(g[0])).toEqual(['coord:0f8a8f92', '임시:grid-bare·grid-bare 작업', '임시:kit·kit 작업'])
    expect(headText(g[1])).toContain('세션 cf0e8ce6')
    expect(headText(g[1])).toContain('팀원 0명')
    expect(deskSlots(g[1])).toEqual(['coord:cf0e8ce6'])
  })

  it('PC 정보(호스트 이름·내 팀 배지·감시자 문구)는 바운더리 머리에 그대로 남고 묶음은 그 안에 들어간다', () => {
    render([coord('0f8a8f92', 1, { mine: true }), lane('a', '0f8a8f92', { mine: true })])
    const host = el.querySelector<HTMLElement>('[data-roster-host]')!
    expect(host.querySelector('h2')?.textContent).toBe('jongik-jang / mac')
    expect(host.querySelector('header')?.textContent).toContain('감시자 없음')
    expect(host.querySelectorAll('[data-roster-group]')).toHaveLength(1)
    expect(host.querySelector('[data-roster-groups]')?.closest('[data-roster-host]')).toBe(host)
  })

  it('팀장이 없으면 「팀장 미확인」 묶음 하나에 임시 팀원이 모인다', () => {
    render([lane('a'), lane('b', '0f8a8f92')])
    const g = groups()
    expect(g).toHaveLength(1)
    expect(g[0].getAttribute('data-roster-group')).toBe('unknown')
    expect(headText(g[0])).toContain('팀장 미확인')
    expect(headText(g[0])).toContain('팀원 2명')
  })

  it('lead 칸이 없는 옛 PC 의 팀원은 레인을 가진 팀장 하나에 붙고 「추정」 안내를 단다 — lead 로 확정된 팀원은 안내가 없다', () => {
    render([coord('0f8a8f92', 2), lane('sure', '0f8a8f92'), lane('guess')])
    const desks = [...el.querySelectorAll<HTMLElement>('[data-roster-desk^="임시:"]')]
    const by = Object.fromEntries(desks.map(d => [d.getAttribute('data-roster-desk')!.slice(3, 7), d.getAttribute('data-group-link')]))
    expect(by.sure).toBe('lead')
    expect(desks.find(d => d.getAttribute('data-group-link') === 'lead')?.getAttribute('title')).toBeNull()
    expect(by.gues).toBe('sole')
    expect(desks.find(d => d.getAttribute('data-group-link') === 'sole')?.getAttribute('title')).toContain('추정')
    expect(groups()).toHaveLength(1)
  })

  it('/dflow-team 팀장은 자기 팀원·빈자리와 한 묶음이다', () => {
    render(
      [watcher(`${HOST}/lead`, { slots: 3, busy: 1, untilLabel: '18:00' }), coord('0f8a8f92', 1), lane('a', '0f8a8f92')],
      [seat('o1', `${HOST}/w1`, 'ACTIVE')],
    )
    const team = groups().find(x => x.getAttribute('data-roster-group') === 'team')!
    expect(headText(team)).toContain('팀장')
    expect(headText(team)).toContain('팀원 1명')
    expect(deskSlots(team)).toEqual(['lead', 'w1', 'w2', 'w3'])
    const coordG = groups().find(x => x.getAttribute('data-roster-group') === 'coord')!
    expect(deskSlots(coordG)).toEqual(['coord:0f8a8f92', '임시:a·a 작업'])
  })

  it('팀장도 임시 팀원도 없는 행은 묶음 없이 종전 평면 격자로 그린다', () => {
    render([], [seat('o1', 'pat-abcd1234', 'ACTIVE')])
    expect(groups()).toHaveLength(0)
    expect(el.querySelectorAll('[data-roster-desk]')).toHaveLength(1)
  })

  it('조정 팀장 상세의 「입력 대기 N건」 은 그 팀장 묶음의 팀원만 센다 — 같은 PC 의 다른 팀장 레인과 섞이지 않는다', () => {
    const req = { kind: 'permission', since: new Date(NOW - 60_000).toISOString(), handled: null }
    render([
      coord('0f8a8f92', 1), coord('cf0e8ce6', 2),
      lane('a', '0f8a8f92', { inputRequest: req as Watcher['inputRequest'] }),
      lane('b', 'cf0e8ce6', { inputRequest: req as Watcher['inputRequest'] }),
      lane('c', 'cf0e8ce6', { inputRequest: req as Watcher['inputRequest'] }),
    ])
    const open = (sid: string) => act(() => { el.querySelector<HTMLElement>(`[data-roster-desk="coord:${sid}"]`)!.click() })
    open('0f8a8f92')
    expect(el.querySelector('[data-lead-input-wait-n]')?.getAttribute('data-lead-input-wait-n')).toBe('1')
    open('cf0e8ce6')
    expect(el.querySelector('[data-lead-input-wait-n]')?.getAttribute('data-lead-input-wait-n')).toBe('2')
  })
})

describe('RosterBoard — 이름 길이와 상관없이 카드 높이가 같다', () => {
  const LONG = 'widget-placement-and-more-extremely-long-lane-name'
  it('이름은 한 줄 말줄임(title 에 전체 이름), 상태 칩은 줄바꿈 없음, 요약 줄은 두 줄 높이로 고정', () => {
    render([coord('0f8a8f92', 2), lane('a', '0f8a8f92'), lane(LONG, '0f8a8f92')])
    const cards = [...el.querySelectorAll<HTMLElement>('[data-roster-desk^="임시:"]')]
    expect(cards).toHaveLength(2)
    const parts = cards.map(c => ({
      title: c.querySelector<HTMLElement>('[data-desk-title]')!,
      status: c.querySelector<HTMLElement>('[data-desk-status]')!,
      line: c.querySelector<HTMLElement>('[data-desk-line]')!,
    }))
    const long = parts[1]
    expect(long.title.getAttribute('title')).toBe(LONG)
    for (const p of parts) {
      expect(p.title.className).toContain('truncate')
      expect(p.status.className).toContain('whitespace-nowrap')
      expect(p.status.className).toContain('shrink-0')
      expect(p.line.className).toContain('line-clamp-2')
      expect(p.line.className).toContain('h-8')
    }
    // 긴 이름·짧은 이름 카드의 높이를 정하는 칸이 같은 규칙을 쓴다.
    for (const key of ['title', 'status', 'line'] as const) expect(parts[0][key].className).toBe(parts[1][key].className)
  })

  it('팀장 카드도 같은 규칙이다', () => {
    render([coord('0f8a8f92', 2)])
    const c = el.querySelector<HTMLElement>('[data-roster-desk="coord:0f8a8f92"]')!
    expect(c.querySelector('[data-desk-title]')?.className).toContain('truncate')
    expect(c.querySelector('[data-desk-status]')?.className).toContain('whitespace-nowrap')
    expect(c.querySelector('[data-desk-line]')?.className).toContain('h-8')
  })

  it('답 대기 배지도 줄바꿈 없이 줄어들지 않는다', () => {
    render([coord('0f8a8f92', 1, { untilLabel: '답 대기' })])
    const badge = el.querySelector<HTMLElement>('[data-roster-desk="coord:0f8a8f92"] [data-answer-wait]')!
    expect(badge.className).toContain('whitespace-nowrap')
    expect(badge.className).toContain('shrink-0')
  })
})
