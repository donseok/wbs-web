// tests/domain/office-chatter.test.ts — 에이전트 보기 말풍선 대사(2026-09-18)
import { describe, it, expect } from 'vitest'
import { EMPTY_LINES, leadChatter, memberReportBubble, NAG_LINES, PRAISE_LINES, QUIET_MS, REPORT_FRESH_MS, SOLO_EMPTY_LINES, SOLO_NAG_LINES } from '@/lib/domain/officeChatter'
import type { RosterDesk, RosterHost } from '@/lib/domain/agentRoster'
import type { Seat } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-18T09:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const member = (slot: string, seat: Partial<Seat>): RosterDesk => ({
  key: `h/${slot}`, slot, label: `팀원 ${slot.slice(1)}`, kind: 'member', watcher: null, raw: `a/h/${slot}`,
  seat: { state: 'ACTIVE', phase: 'build', lastReport: null, ...seat } as Seat,
})
const host = (...desks: RosterDesk[]): RosterHost => ({ key: 'a/h', label: 'a / h', conforming: true, watcher: null, slots: 2, desks })

describe('leadChatter', () => {
  it('최근 보고가 있으면 잔소리하지 않는다', () => {
    expect(leadChatter(host(member('w1', { lastReport: { kind: 'progress', summary: 's', at: iso(50_000) } })), NOW)).toBeNull()
  })
  it('한동안 아무도 보고하지 않으면 잔소리하고, {name} 을 가장 조용한 팀원으로 채운다', () => {
    const c = leadChatter(host(member('w1', {}), member('w2', { lastReport: { kind: 'progress', summary: 's', at: iso(QUIET_MS + 1) } })), NOW)
    expect(c?.tone).toBe('nag')
    expect(c!.text).not.toContain('{name}')
    const pool = NAG_LINES.map(l => l.replaceAll('{name}', '팀원 1'))
    expect(pool).toContain(c!.text)
  })
  it('무응답 팀원이 있으면 다른 팀원이 보고 중이어도 그 팀원을 지목한다', () => {
    const h = host(member('w1', { lastReport: { kind: 'progress', summary: 's', at: iso(50_000) } }), member('w2', { state: 'STALE' }))
    for (let t = 0; t < NAG_LINES.length; t++) {
      const c = leadChatter(h, NOW + t * 8_000)!
      expect(c.tone).toBe('nag')
      expect(c.text).not.toContain('팀원 1')
    }
  })
  it('막 보고가 들어오면 칭찬한다', () => {
    const c = leadChatter(host(member('w1', { lastReport: { kind: 'completion', summary: 's', at: iso(20_000) } })), NOW)
    expect(c?.tone).toBe('praise')
    expect(PRAISE_LINES.map(l => l.replaceAll('{name}', '팀원 1'))).toContain(c!.text)
  })
  it('대사는 8초마다 바뀐다', () => {
    const h = host(member('w1', {}))
    const seen = new Set(Array.from({ length: 6 }, (_, i) => leadChatter(h, NOW + i * 8_000)!.text))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('memberReportBubble', () => {
  it('최근 보고는 머리말 + 요약, 오래된 보고는 null', () => {
    const fresh = memberReportBubble(member('w1', { lastReport: { kind: 'completion', summary: '로그인 완료', at: iso(60_000) } }), NOW)
    expect(fresh?.text).toBe('로그인 완료')
    expect(fresh?.opener).toBeTruthy()
    expect(memberReportBubble(member('w1', { lastReport: { kind: 'progress', summary: 'x', at: iso(REPORT_FRESH_MS + 1) } }), NOW)).toBeNull()
  })
  it('머리말은 같은 보고에 대해 시간이 흘러도 그대로다', () => {
    const d = member('w1', { lastReport: { kind: 'progress', summary: 'x', at: iso(0) } })
    expect(memberReportBubble(d, NOW)?.opener).toBe(memberReportBubble(d, NOW + 60_000)?.opener)
  })
})

describe('leadChatter — 혼자일 때(2026-09-18)', () => {
  it('일하는 팀원이 하나도 없으면(빈자리뿐) 한탄한다', () => {
    const c = leadChatter(host(), NOW)
    expect(c?.tone).toBe('empty')
    expect(EMPTY_LINES).toContain(c!.text)
  })
  it('결정 대기 팀원만 있으면 말하지 않는다', () => {
    expect(leadChatter(host(member('w1', { state: 'BLOCKED' })), NOW)).toBeNull()
  })
  it('단독 감시는 자기 이름을 부르지 않고 혼잣말을 한다', () => {
    const me = { ...member('w1', {}), slot: 'poll', label: '단독 감시' }
    const h = host(me)
    const nag = leadChatter(h, NOW, { slot: 'poll' })!
    expect(SOLO_NAG_LINES).toContain(nag.text)
    expect(SOLO_EMPTY_LINES).toContain(leadChatter(host(), NOW, { slot: 'poll' })!.text)
  })
})
