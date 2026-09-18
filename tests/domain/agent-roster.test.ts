import { describe, expect, it } from 'vitest'
import { assembleRoster, parseAgentId, slotLabel } from '@/lib/domain/agentRoster'
import type { Floor, Seat, Watcher } from '@/lib/domain/seatmap'

const seat = (orderId: string, agent: string | null, state: Seat['state']): Seat =>
  ({ orderId, agent, state, code: orderId, name: orderId } as unknown as Seat)
const watcher = (agent: string, slots: number | null, lastSeenAt = '2026-09-18T00:00:00Z'): Watcher =>
  ({ agent, host: null, slots, busy: null, untilLabel: null, lastSeenAt, projectId: null })
const floor = (seats: Seat[], watchers: Watcher[]): Floor =>
  ({ id: 'p', name: 'P', seatCount: seats.length, doneCount: 0, watchers, zones: [{ key: 'z', code: 'Z', name: 'Z', seats, summary: { work: 0, wait: 0, ready: 0, done: 0 } }] })

describe('parseAgentId · slotLabel', () => {
  it('<신원>/<host>/<자리> 세 토막만 작업 PC 로 인정한다', () => {
    expect(parseAgentId('jji/macbook/w2')).toEqual({ owner: 'jji', host: 'macbook', slot: 'w2' })
    expect(parseAgentId('claude-macbook')).toBeNull()
    expect(parseAgentId('pat-8f3a21bc')).toBeNull()
    expect(parseAgentId('a/b')).toBeNull()
    expect(parseAgentId('a//w1')).toBeNull()
  })
  it('자리 토큰을 사람 말로 바꾼다', () => {
    expect(slotLabel('w1')).toBe('팀원 1')
    expect(slotLabel('lead')).toBe('팀장')
    expect(slotLabel('poll')).toBe('단독 감시')
  })
})

describe('assembleRoster', () => {
  it('작업 PC 로 묶고 팀장을 맨 앞, 빈자리를 좌석 수만큼 채운다', () => {
    const r = assembleRoster({ floors: [floor(
      [seat('o1', 'jji/macbook/w1', 'ACTIVE'), seat('o2', 'jji/macbook/w2', 'BLOCKED'), seat('o3', 'jji/macbook/w3', 'WAIT')],
      [watcher('jji/macbook/lead', 3)],
    )] })
    expect(r.hosts).toHaveLength(1)
    const h = r.hosts[0]
    expect(h.label).toBe('jji / macbook')
    expect(h.desks.map(d => `${d.kind}:${d.label}`)).toEqual(['lead:팀장', 'member:팀원 1', 'member:팀원 2', 'empty:팀원 3'])
    expect(r.tiles).toEqual({ working: 1, blocked: 1, stale: 0, offline: 0, empty: 1 })
    expect(r.agentCount).toBe(2)
  })
  it('규칙 밖 신원은 자기 이름 한 줄로 뒤에 둔다', () => {
    const r = assembleRoster({ floors: [floor([seat('o1', 'pat-8f3a21bc', 'STALE'), seat('o2', 'jji/win/w1', 'OFFLINE')], [])] })
    expect(r.hosts.map(h => [h.label, h.conforming])).toEqual([['jji / win', true], ['pat-8f3a21bc', false]])
    expect(r.hosts[1].desks[0].label).toBe('외부 에이전트')
    expect(r.tiles).toMatchObject({ stale: 1, offline: 1, empty: 0 })
  })
  it('여러 층에 겹쳐 실린 감시자는 한 번만 센다', () => {
    const w = watcher('jji/macbook/lead', 2)
    const r = assembleRoster({ floors: [floor([], [w]), { ...floor([], [w]), id: 'q' }] })
    expect(r.hosts[0].desks.filter(d => d.kind === 'lead')).toHaveLength(1)
    expect(r.tiles.empty).toBe(2)
  })
})
