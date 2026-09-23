// tests/domain/office-chatter.test.ts — 에이전트 보기 말풍선 대사(2026-09-18)
import { describe, it, expect } from 'vitest'
import { AWAY_HOLD_MS, AWAY_LINES, AWAY_LUNCH_LINES, AWAY_OFF_HOURS_LINES, awayBubble, awayReason, EMPTY_LINES, MEMBER_LINES, MEMBER_PHASE_LINES, memberChatter, MUSING_LINES, SEASON_LINES, seasonOf, leadChatter, memberReportBubble, NAG_LINES, PRAISE_LINES, QUIET_MS, REPORT_FRESH_MS, SOLO_EMPTY_LINES, SOLO_NAG_LINES, WAIT_LINES } from '@/lib/domain/officeChatter'
import type { RosterDesk, RosterHost } from '@/lib/domain/agentRoster'
import type { Seat } from '@/lib/domain/seatmap'
import LINES from '@/lib/domain/officeChatter.lines.json'

const NOW = Date.parse('2026-09-18T09:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const member = (slot: string, seat: Partial<Seat>): RosterDesk => ({
  key: `h/${slot}`, slot, label: `팀원 ${slot.slice(1)}`, kind: 'member', watcher: null, raw: `a/h/${slot}`, leads: [],
  seat: { orderId: `o-${slot}`, state: 'ACTIVE', phase: 'build', lastReport: null, ...seat } as Seat,
})
const host = (...desks: RosterDesk[]): RosterHost => ({ key: 'a/h', label: 'a / h', conforming: true, mine: false, watcher: null, slots: 2, desks })

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
  const pools = { NAG_LINES, PRAISE_LINES, EMPTY_LINES, MUSING_LINES, SOLO_NAG_LINES, SOLO_EMPTY_LINES, ...SEASON_LINES, MEMBER_LINES, ...Object.fromEntries(Object.entries(MEMBER_PHASE_LINES).map(([k, v]) => [`member-${k}`, v])) }
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
    for (const l of [...EMPTY_LINES, ...MUSING_LINES, ...MEMBER_LINES, ...Object.values(MEMBER_PHASE_LINES).flat(), ...SOLO_NAG_LINES, ...SOLO_EMPTY_LINES, ...Object.values(SEASON_LINES).flat()]) {
      expect(l, l).not.toContain('{name}')
    }
  })
})

describe('대사 고르기 — 주제가 고르게 섞인다(2026-09-18 "먹는 얘기만 한다")', () => {
  const MUSE = LINES['공통 (팀원 있을 때·없을 때 모두)'] as Record<string, string[] | string>
  const topicOf = (t: string) => Object.entries(MUSE).find(([k, v]) => !k.startsWith('$') && Array.isArray(v) && v.includes(t))?.[0]
  it('빈자리 혼잣말이 한 주제로 몰리지 않고, 같은 주제가 연달아 나오지 않는다', () => {
    const topics = Array.from({ length: 120 }, (_, i) => topicOf(leadChatter(host(), NOW + i * 8_000)!.text)).filter(Boolean) as string[]
    const count = new Map<string, number>()
    for (const t of topics) count.set(t, (count.get(t) ?? 0) + 1)
    expect(count.size).toBeGreaterThanOrEqual(6)
    expect(Math.max(...count.values()) / topics.length).toBeLessThan(0.3)
    // 혼잣말은 두 칸에 한 번 — 이웃한 혼잣말 칸끼리 같은 주제가 세 번 연달아 나오지 않는다
    for (let i = 2; i < topics.length; i++) expect(topics[i] === topics[i - 1] && topics[i] === topics[i - 2]).toBe(false)
  })
  it('빈자리일 때 "다들 어디 갔어" 류 한탄이 절반쯤 나온다', () => {
    const n = Array.from({ length: 40 }, (_, i) => leadChatter(host(), NOW + i * 8_000)!.text).filter(t => EMPTY_LINES.includes(t)).length
    expect(n).toBeGreaterThanOrEqual(15)
  })
  it('연봉 대사가 공통 혼잣말에 있다', () => {
    expect(MUSING_LINES).toContain('사장님 연봉 올려 주세요.')
    expect(MEMBER_LINES).toContain('사장님 연봉 올려 주세요.')
  })
})

describe('memberChatter — 작업 중인 팀원의 한마디(2026-09-18)', () => {
  const texts = (d: RosterDesk, n = 60) => Array.from({ length: n }, (_, i) => memberChatter(d, NOW + i * 8_000))
  it('작업 중일 때 세 칸에 한 칸만 말하고, 나머지 칸은 단계 말풍선에 양보한다', () => {
    const t = texts(member('w1', { phase: 'verify' }))
    expect(t.filter(Boolean).length).toBe(20)
    for (const x of t.filter(Boolean)) expect([...MEMBER_LINES, ...MEMBER_PHASE_LINES.verify]).toContain(x)
  })
  it('지금 단계의 대사가 섞여 나온다', () => {
    const t = texts(member('w1', { phase: 'design' }), 300).filter(Boolean)
    expect(t.some(x => MEMBER_PHASE_LINES.design.includes(x!))).toBe(true)
    expect(t.some(x => MEMBER_PHASE_LINES.build.includes(x!))).toBe(false)
  })
  it('승인 대기면 세 칸에 한 칸 승인을 조른다', () => {
    const t = texts(member('w1', { state: 'WAIT', phase: 'reported' }))
    expect(t.filter(Boolean).length).toBe(20)
    for (const x of t.filter(Boolean)) expect(WAIT_LINES).toContain(x)
    expect(WAIT_LINES).toContain('승인해 주세요!')
  })
  it('작업 중·승인 대기가 아니면(무응답·결정 대기·완료) 말하지 않는다', () => {
    for (const state of ['STALE', 'OFFLINE', 'BLOCKED', 'DONE'] as const) {
      expect(texts(member('w1', { state })).every(x => x === null), state).toBe(true)
    }
  })
  it('팀원마다 말하는 박자가 달라 한꺼번에 떠들지 않는다', () => {
    const talking = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(s => texts(member(s, {}), 3).map(Boolean))
    expect(new Set(talking.map(t => t.indexOf(true))).size).toBeGreaterThan(1)
  })
})

describe('빈자리 부재 사유(2026-09-19)', () => {
  const DAY = Date.parse('2026-09-18T01:00:00Z') // 한국 시간 10시 — 시간대 묶음이 섞이지 않는다
  it('같은 자리는 5분 동안 같은 사유를 유지하고, 상시 묶음에서 고른다', () => {
    const start = Math.floor(DAY / AWAY_HOLD_MS) * AWAY_HOLD_MS
    const r = awayReason('empty:a/h:w2', start)
    expect(AWAY_LINES).toContain(r)
    for (let t = start; t < start + AWAY_HOLD_MS; t += 30_000) expect(awayReason('empty:a/h:w2', t)).toBe(r)
  })
  it('자리마다 사유가 흩어지고, 하루 동안 여러 주제가 나온다', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `empty:a/h:w${i}`)
    expect(new Set(keys.map(k => awayReason(k, DAY))).size).toBeGreaterThan(4)
    const seen = new Set<string>()
    for (let k = 0; k < 60; k++) seen.add(awayReason('empty:a/h:w2', DAY + k * AWAY_HOLD_MS))
    expect(seen.size).toBeGreaterThan(10)
  })
  it('점심시간과 퇴근 뒤에는 그 시간대 사유가 섞인다', () => {
    const lunch = Date.parse('2026-09-18T03:10:00Z') // 한국 시간 12:10
    const night = Date.parse('2026-09-18T12:00:00Z') // 한국 시간 21:00
    const at = (base: number) => Array.from({ length: 30 }, (_, i) => awayReason(`empty:a/h:w${i}`, base))
    expect(at(lunch).some(r => AWAY_LUNCH_LINES.includes(r))).toBe(true)
    expect(at(night).some(r => AWAY_OFF_HOURS_LINES.includes(r))).toBe(true)
    expect(at(DAY).some(r => AWAY_LUNCH_LINES.includes(r) || AWAY_OFF_HOURS_LINES.includes(r))).toBe(false)
  })
  it('말풍선은 세 칸에 한 칸이고, 뜨면 그때의 사유다', () => {
    const shown = Array.from({ length: 30 }, (_, k) => awayBubble('empty:a/h:w2', DAY + k * 8_000))
    expect(shown.filter(Boolean).length).toBe(10)
    for (let k = 0; k < 30; k++) {
      const b = shown[k]
      if (b) expect(b).toBe(awayReason('empty:a/h:w2', DAY + k * 8_000))
    }
  })
  it('대사 JSON 에 설명과 묶음이 있다', () => {
    const away = (LINES as Record<string, Record<string, unknown>>)['빈자리 부재 사유']
    expect(typeof away['$설명']).toBe('string')
    expect(AWAY_LINES).toContain('담타 중')
    expect(AWAY_LINES).toContain('커피 마시러 감')
  })
})
