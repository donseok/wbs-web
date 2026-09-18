// tests/domain/office-chatter.test.ts — 에이전트 보기 말풍선 대사(2026-09-18)
import { describe, it, expect } from 'vitest'
import { EMPTY_LINES, MUSING_LINES, SEASON_LINES, seasonOf, leadChatter, memberReportBubble, NAG_LINES, PRAISE_LINES, QUIET_MS, REPORT_FRESH_MS, SOLO_EMPTY_LINES, SOLO_NAG_LINES } from '@/lib/domain/officeChatter'
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
    expect(['nag', 'empty']).toContain(c?.tone)
    expect(c!.text).not.toContain('{name}')
    const pool = [...NAG_LINES.map(l => l.replaceAll('{name}', '팀원 1')), ...MUSING_LINES, ...SEASON_LINES[seasonOf(NOW)]]
    expect(pool).toContain(c!.text)
  })
  it('무응답 팀원이 있으면 다른 팀원이 보고 중이어도 그 팀원을 지목한다', () => {
    const h = host(member('w1', { lastReport: { kind: 'progress', summary: 's', at: iso(50_000) } }), member('w2', { state: 'STALE' }))
    for (let t = 0; t < NAG_LINES.length; t++) {
      const c = leadChatter(h, NOW + t * 8_000)!
      expect(c.tone === 'nag' || [...MUSING_LINES, ...SEASON_LINES[seasonOf(NOW)]].includes(c.text)).toBe(true)
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
    expect([...EMPTY_LINES, ...MUSING_LINES, ...SEASON_LINES[seasonOf(NOW)]]).toContain(c!.text)
  })
  it('결정 대기 팀원만 있으면 말하지 않는다', () => {
    expect(leadChatter(host(member('w1', { state: 'BLOCKED' })), NOW)).toBeNull()
  })
  it('단독 감시는 자기 이름을 부르지 않고 혼잣말을 한다', () => {
    const me = { ...member('w1', {}), slot: 'poll', label: '단독 감시' }
    const h = host(me)
    for (let i = 0; i < 12; i++) {
      const nag = leadChatter(h, NOW + i * 8_000, { slot: 'poll' })!
      expect([...SOLO_NAG_LINES, ...MUSING_LINES, ...SEASON_LINES[seasonOf(NOW)]]).toContain(nag.text)
      expect([...SOLO_EMPTY_LINES, ...MUSING_LINES, ...SEASON_LINES[seasonOf(NOW)]]).toContain(leadChatter(host(), NOW + i * 8_000, { slot: 'poll' })!.text)
    }
  })
})

describe('leadChatter — 혼잣말(신세 한탄·메뉴 고민)', () => {
  it('잔소리 중에도 네 번에 한 번꼴로 혼잣말이 끼어든다', () => {
    const h = host(member('w1', {}))
    const texts = Array.from({ length: 40 }, (_, i) => leadChatter(h, NOW + i * 8_000)!.text)
    const m = texts.filter(t => [...MUSING_LINES, ...SEASON_LINES[seasonOf(NOW)]].includes(t)).length
    expect(m).toBeGreaterThanOrEqual(8)
    expect(m).toBeLessThanOrEqual(12)
  })
})

describe('seasonOf — 계절 대사는 한국 시간 달을 따른다', () => {
  it('봄·여름·가을·겨울', () => {
    expect(seasonOf(Date.parse('2026-04-10T00:00:00+09:00'))).toBe('spring')
    expect(seasonOf(Date.parse('2026-07-10T00:00:00+09:00'))).toBe('summer')
    expect(seasonOf(Date.parse('2026-09-18T09:00:00+09:00'))).toBe('autumn')
    expect(seasonOf(Date.parse('2026-12-01T00:30:00+09:00'))).toBe('winter')
    // 11월 30일 밤 UTC 는 이미 한국 12월 — 겨울
    expect(seasonOf(Date.parse('2026-11-30T15:30:00Z'))).toBe('winter')
  })
})

describe('officeChatter.lines.json — 손으로 고치는 대사 파일의 안전망', () => {
  const pools = { NAG_LINES, PRAISE_LINES, EMPTY_LINES, MUSING_LINES, SOLO_NAG_LINES, SOLO_EMPTY_LINES, ...SEASON_LINES }
  it('묶음마다 대사가 있고 빈 줄이 없다', () => {
    for (const [k, ls] of Object.entries(pools)) {
      expect(ls.length, k).toBeGreaterThan(0)
      for (const l of ls) expect(typeof l === 'string' && l.trim().length > 0, `${k}: "${l}"`).toBe(true)
    }
  })
  it('한 상황 안에 같은 대사가 두 번 들어 있지 않다(상황이 다르면 겹쳐도 된다)', () => {
    for (const [k, ls] of Object.entries(pools)) {
      expect(ls.filter((l, i) => ls.indexOf(l) !== i), k).toEqual([])
    }
  })
  it('팀원이 있을 때만 뜻이 통하는 말과 없을 때만 통하는 말이 공통 혼잣말에 섞이지 않는다', () => {
    for (const l of MUSING_LINES) expect(l, l).not.toMatch(/\{name\}|퇴근한 것 같아|다들 어디/)
  })
  it('{name} 은 잔소리·칭찬에서만 쓴다 — 다른 묶음에선 바뀌지 않고 그대로 보인다', () => {
    for (const l of [...EMPTY_LINES, ...MUSING_LINES, ...SOLO_NAG_LINES, ...SOLO_EMPTY_LINES, ...Object.values(SEASON_LINES).flat()]) {
      expect(l, l).not.toContain('{name}')
    }
  })
})
