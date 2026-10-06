// 팀장 한 명당 바운더리 하나 — groupHostDesks 묶음 규칙(2026-10-06 지시 office-group-1).
// 임시 팀원 ↔ 조정 팀장 연결: lead 칸(확정) · 팀장 요약의 조용한 레인(quiet) · 레인을 가진 조정 팀장이 하나뿐(sole) · 그 밖은 미확인.
import { describe, expect, it } from 'vitest'
import { assembleRoster, groupHostDesks, type RosterGroup } from '@/lib/domain/agentRoster'
import { parseLaneSummary } from '@/lib/domain/laneSummary'
import { parseLeadSummary } from '@/lib/domain/watcherExtras'
import type { Floor, Seat, Watcher } from '@/lib/domain/seatmap'

const seat = (orderId: string, agent: string | null, state: Seat['state']): Seat =>
  ({ orderId, agent, state, code: orderId, name: orderId } as unknown as Seat)
const watcher = (agent: string, over: Partial<Watcher> = {}): Watcher =>
  ({ agent, host: null, slots: null, busy: null, untilLabel: null, lastSeenAt: '2026-10-06T00:00:00Z', projectId: null, ...over })
const floor = (seats: Seat[], watchers: Watcher[]): Floor =>
  ({ id: 'p', name: 'P', seatCount: seats.length, doneCount: 0, watchers, leads: [], zones: [{ key: 'z', code: 'Z', name: 'Z', seats, summary: { work: 0, wait: 0, ready: 0, done: 0 } }] })

const HOST = 'jongik-jang/mac'
const laneSummary = (lane: string, lead?: string | null) => {
  const r = parseLaneSummary({ v: 1, lane, state: 'active', items_done: 0, items_total: 1, ...(lead === undefined ? {} : { lead }) })
  if (!r.ok || !r.value) throw new Error('summary')
  return r.value
}
const quietSummary = (...quiet: string[]) => {
  const r = parseLeadSummary({ v: 1, runs: [{ run: 'r1', lanes: { working: 1, waiting: 0, done: 0, quiet } }] })
  if (!r.ok || !r.value) throw new Error('lead_summary')
  return r.value
}
const coord = (sid: string, lanes: number, over: Partial<Watcher> = {}) =>
  watcher(`${HOST}/coord:${sid}`, { slots: lanes, busy: lanes, untilLabel: '조정 중', ...over })
const lane = (name: string, lead?: string | null, over: Partial<Watcher> = {}) =>
  watcher(`${HOST}/임시:${name}·${name} 작업`, { untilLabel: '작업 중', summary: laneSummary(name, lead), ...over })

const groupsOf = (watchers: Watcher[], seats: Seat[] = []): RosterGroup[] | null => {
  const host = assembleRoster({ floors: [floor(seats, watchers)] }).hosts[0]
  return groupHostDesks(host)
}
const names = (g: RosterGroup) => g.members.map(d => d.temp?.lane ?? d.slot)

describe('groupHostDesks — 조정 팀장마다 묶음 하나', () => {
  it('팀장 2명과 각자의 팀원(lead 칸 확정) — 묶음 둘, 팀장이 맨 앞, 팀원은 자기 팀장에게만', () => {
    const g = groupsOf([
      coord('0f8a8f92', 2), coord('cf0e8ce6', 1),
      lane('grid-core', '0f8a8f92'), lane('grid-adopt', '0f8a8f92'), lane('kit', 'cf0e8ce6'),
    ])!
    expect(g.map(x => x.kind)).toEqual(['coord', 'coord'])
    const a = g.find(x => x.lead?.slot === 'coord:0f8a8f92')!
    const b = g.find(x => x.lead?.slot === 'coord:cf0e8ce6')!
    expect(names(a)).toEqual(['grid-adopt', 'grid-core'])
    expect(names(b)).toEqual(['kit'])
    expect(a.memberCount).toBe(2)
    expect(b.memberCount).toBe(1)
    expect(Object.values(a.links)).toEqual(['lead', 'lead'])
    expect(Object.values(b.links)).toEqual(['lead'])
  })

  it('팀원이 없는 팀장도 묶음 하나다(팀원 0명)', () => {
    const g = groupsOf([coord('0f8a8f92', 2), coord('cf0e8ce6', 0), lane('a', '0f8a8f92'), lane('b', '0f8a8f92')])!
    const empty = g.find(x => x.lead?.slot === 'coord:cf0e8ce6')!
    expect(empty.members).toEqual([])
    expect(empty.memberCount).toBe(0)
  })

  it('lead 칸이 가리키는 팀장이 이 PC 에 없으면 미확인 — 대체 규칙으로 다른 팀장에게 붙이지 않는다', () => {
    const g = groupsOf([coord('0f8a8f92', 1), lane('old', 'dead0000')])!
    expect(g.map(x => x.kind)).toEqual(['coord', 'unknown'])
    expect(names(g[0])).toEqual([])
    expect(names(g[1])).toEqual(['old'])
  })

  it('다른 PC 의 팀장 세션은 이 PC 의 팀원을 가져가지 못한다', () => {
    const other = watcher('jongik-jang/other/coord:0f8a8f92', { slots: 1, busy: 1 })
    const roster = assembleRoster({ floors: [floor([], [other, lane('x', '0f8a8f92')])] })
    const mac = roster.hosts.find(h => h.key === HOST)!
    const g = groupHostDesks(mac)!
    expect(g.map(x => x.kind)).toEqual(['unknown'])
  })
})

describe('groupHostDesks — lead 칸이 없는 옛 PC 의 대체 규칙(추정)', () => {
  it('팀장 요약의 조용한 레인 이름에 한 팀장만 들어 있으면 그 팀장 — 근거 quiet', () => {
    const g = groupsOf([
      coord('0f8a8f92', 1, { leadSummary: quietSummary('docs') }), coord('cf0e8ce6', 1, { leadSummary: quietSummary('web') }),
      lane('docs'), lane('web'),
    ])!
    const a = g.find(x => x.lead?.slot === 'coord:0f8a8f92')!
    const b = g.find(x => x.lead?.slot === 'coord:cf0e8ce6')!
    expect(names(a)).toEqual(['docs'])
    expect(names(b)).toEqual(['web'])
    expect(Object.values(a.links)).toEqual(['quiet'])
  })

  it('레인을 가진(레인 수>0) 조정 팀장이 하나뿐이면 그 팀장 — 근거 sole(레인 0개 팀장은 후보가 아니다)', () => {
    const g = groupsOf([coord('0f8a8f92', 2), coord('cf0e8ce6', 0), lane('a'), lane('b')])!
    const a = g.find(x => x.lead?.slot === 'coord:0f8a8f92')!
    expect(names(a)).toEqual(['a', 'b'])
    expect(Object.values(a.links)).toEqual(['sole', 'sole'])
    expect(g.some(x => x.kind === 'unknown')).toBe(false)
  })

  it('레인 수를 모르는(slots null) 팀장은 후보로 남는다 — 하나뿐이면 그 팀장에 붙는다', () => {
    const g = groupsOf([coord('0f8a8f92', 0, { slots: null, busy: null }), lane('a')])!
    expect(g.map(x => x.kind)).toEqual(['coord'])
    expect(names(g[0])).toEqual(['a'])
  })

  it('레인을 가진 팀장이 둘이고 조용한 레인으로도 못 가르면 미확인', () => {
    const g = groupsOf([coord('0f8a8f92', 1), coord('cf0e8ce6', 1), lane('a'), lane('b')])!
    expect(g.map(x => x.kind)).toEqual(['coord', 'coord', 'unknown'])
    expect(names(g[2])).toEqual(['a', 'b'])
  })

  it('같은 레인 이름이 두 팀장의 조용한 레인에 모두 있으면 quiet 로 가르지 않는다', () => {
    const g = groupsOf([coord('0f8a8f92', 1, { leadSummary: quietSummary('docs') }), coord('cf0e8ce6', 1, { leadSummary: quietSummary('docs') }), lane('docs')])!
    expect(g.at(-1)!.kind).toBe('unknown')
  })

  it('확정(lead)과 추정(sole)은 따로 기록된다 — 같은 PC 에 섞여도 근거가 책상마다 남는다', () => {
    const g = groupsOf([coord('0f8a8f92', 2), lane('sure', '0f8a8f92'), lane('guess')])!
    const a = g.find(x => x.kind === 'coord')!
    const byLane = Object.fromEntries(a.members.map(d => [d.temp!.lane, a.links[d.key]]))
    expect(byLane).toEqual({ sure: 'lead', guess: 'sole' })
  })
})

describe('groupHostDesks — 팀장 0명·팀장 없는 팀원·dflow-team 팀장', () => {
  it('팀장이 없고 임시 팀원만 있으면 「팀장 미확인」 하나', () => {
    const g = groupsOf([lane('a', '0f8a8f92'), lane('b')])!
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ kind: 'unknown', lead: null, memberCount: 2 })
  })

  it('팀장이 없는 팀원(w<N>)은 임시 팀원과 함께 미확인 묶음에 들어간다', () => {
    const g = groupsOf([lane('a')], [seat('o1', `${HOST}/w1`, 'ACTIVE')])!
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('unknown')
    expect(g[0].members.map(d => d.kind).sort()).toEqual(['member', 'temp'])
  })

  it('팀장도 임시 팀원도 없는 행(팀원·규칙 밖 에이전트만)은 묶지 않는다 — null', () => {
    const r = assembleRoster({ floors: [floor([seat('o1', `${HOST}/w1`, 'ACTIVE'), seat('o2', 'pat-abcd1234', 'ACTIVE')], [])] })
    for (const h of r.hosts) expect(groupHostDesks(h)).toBeNull()
  })

  it('/dflow-team 팀장은 팀원(w<N>)·빈자리와 한 묶음이다(kind=team) — 조정 팀장 묶음과 따로', () => {
    const g = groupsOf(
      [watcher(`${HOST}/lead`, { slots: 3, busy: 2, untilLabel: '18:00' }), coord('0f8a8f92', 1), lane('a', '0f8a8f92')],
      [seat('o1', `${HOST}/w1`, 'ACTIVE'), seat('o2', `${HOST}/w2`, 'BLOCKED')],
    )!
    const team = g.find(x => x.kind === 'team')!
    expect(team.lead!.slot).toBe('lead')
    expect(team.members.map(d => d.slot)).toEqual(['w1', 'w2', 'w3'])
    expect(team.members.map(d => d.kind)).toEqual(['member', 'member', 'empty'])
    expect(team.memberCount).toBe(2) // 빈자리는 팀원 수에 세지 않는다
    expect(names(g.find(x => x.kind === 'coord')!)).toEqual(['a'])
    expect(g.some(x => x.kind === 'unknown')).toBe(false)
  })

  it('감시자 정보를 준 팀장(lead)이 팀원을 쥐고, 단독 감시(poll)는 팀원 0명 묶음이다', () => {
    const g = groupsOf(
      [watcher(`${HOST}/lead`, { slots: 1, busy: 1, lastSeenAt: '2026-10-06T01:00:00Z' }), watcher(`${HOST}/poll`, { slots: 5, busy: 0 })],
      [seat('o1', `${HOST}/w1`, 'ACTIVE')],
    )!
    expect(g.filter(x => x.kind === 'team')).toHaveLength(2)
    const withMembers = g.filter(x => x.memberCount > 0)
    expect(withMembers).toHaveLength(1)
    expect(withMembers[0].lead!.slot).toBe('lead')
  })

  it('단독 감시(poll)의 신호가 더 최근이어도 팀원은 lead 팀장에게 붙는다 — 신호 순서가 바뀌어도 소속이 오가지 않는다', () => {
    const g = groupsOf(
      [watcher(`${HOST}/lead`, { slots: 1, busy: 1, lastSeenAt: '2026-10-06T01:00:00Z' }), watcher(`${HOST}/poll`, { slots: 5, busy: 0, lastSeenAt: '2026-10-06T02:00:00Z' })],
      [seat('o1', `${HOST}/w1`, 'ACTIVE')],
    )!
    const withMembers = g.filter(x => x.memberCount > 0)
    expect(withMembers).toHaveLength(1)
    expect(withMembers[0].lead!.slot).toBe('lead')
  })

  it('책상 목록(host.desks)은 묶음을 만들어도 바뀌지 않는다', () => {
    const roster = assembleRoster({ floors: [floor([], [coord('0f8a8f92', 1), lane('a', '0f8a8f92')])] })
    const before = roster.hosts[0].desks.map(d => d.key)
    groupHostDesks(roster.hosts[0])
    expect(roster.hosts[0].desks.map(d => d.key)).toEqual(before)
  })
})
