// 좌석표 조회가 감시자에 요약 세 칸을 싣는 방식 — 발췌·해시는 싣지 않는다(권한은 콘솔 보기 액션이 따로 본다).
import { describe, expect, it } from 'vitest'
import { assembleSeatmap, type OrderRow, type SeatmapRows, type WatcherRow } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-10-06T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const wrow = (agent: string, over: Partial<WatcherRow> = {}): WatcherRow =>
  ({ id: agent, user_id: 'u1', project_id: null, agent, host: null, slots: null, busy: null, until_label: '작업 중', last_seen_at: ago(60_000), ...over })
const order: OrderRow = {
  id: '11111111-aaaa-4aaa-8aaa-000000000001', project_id: 'p1', wbs_item_id: 'i1', status: 'ready',
  claimed_by: null, claimed_by_user_id: null, claimed_at: null, created_at: ago(7200_000), updated_at: ago(60_000),
  last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null,
}
const rows = (watchers: WatcherRow[]): SeatmapRows => ({
  orders: [order],
  items: [{ id: 'i1', project_id: 'p1', code: 'T', name: 'n', parent_id: 'z1', actual_pct: 0, assignee_member_id: null, tags: ['agent'] }],
  parents: [{ id: 'z1', project_id: 'p1', code: 'WP', name: 'wp', parent_id: null, actual_pct: null, assignee_member_id: null, tags: ['agent'] }],
  reviews: [], watchers, projects: [{ id: 'p1', name: 'mes' }], members: [], predecessors: [],
})
const SHA = 'a'.repeat(64)
const summary = { v: 1, lane: 'eng', state: 'active', brief: '엔진', items_done: 1, items_total: 3, hold: null, branch: 'feat/x', last_report_at: null, last_instr_at: null, ctx_pct: null, compact_pending: false }
const inputReq = { v: 1, kind: 'permission', since: '2026-10-06T08:50:00Z', excerpt: ['Allow rm -rf? (y/n)'], handled: null, sha: SHA }

describe('assembleSeatmap — 감시자의 summary·lead_summary·input_request', () => {
  it('레인 요약·팀장 요약을 읽어 감시자에 붙이고, 칸이 없는 행은 null 이다', () => {
    const m = assembleSeatmap(rows([
      wrow('jji/mac/임시:eng·x', { summary }),
      wrow('jji/mac/coord:abcd1234', { lead_summary: { v: 1, runs: [{ run: 'r1' }] } }),
      wrow('jji/mac/lead'),
    ]), NOW)
    const by = Object.fromEntries(m.floors[0].watchers.map(w => [w.agent, w]))
    expect(by['jji/mac/임시:eng·x'].summary).toMatchObject({ lane: 'eng', itemsTotal: 3 })
    expect(by['jji/mac/coord:abcd1234'].leadSummary?.runs[0].run).toBe('r1')
    expect(by['jji/mac/lead'].summary).toBeNull()
    expect(by['jji/mac/lead'].leadSummary).toBeNull()
    expect(by['jji/mac/lead'].inputRequest).toBeNull()
  })
  it('입력 요청은 종류·시각·처리 여부만 싣고 발췌·해시는 싣지 않는다(열람 권한 밖 노출 방지)', () => {
    const m = assembleSeatmap(rows([wrow('jji/mac/임시:eng·x', { input_request: inputReq })]), NOW)
    const w = m.floors[0].watchers[0]
    expect(w.inputRequest).toEqual({ v: 1, kind: 'permission', since: '2026-10-06T08:50:00Z', handled: null })
    const json = JSON.stringify(m)
    expect(json).not.toContain('Allow rm -rf')
    expect(json).not.toContain(SHA)
  })
  it('깨진 저장값은 null 로 읽고 조회 전체는 깨지지 않는다 — sha 없는 입력 요청도 null(fail-closed)', () => {
    const m = assembleSeatmap(rows([
      wrow('jji/mac/임시:eng·x', { summary: { v: 9 }, lead_summary: 'x', input_request: { ...inputReq, sha: undefined } }),
    ]), NOW)
    const w = m.floors[0].watchers[0]
    expect(w.summary).toBeNull()
    expect(w.leadSummary).toBeNull()
    expect(w.inputRequest).toBeNull()
  })
})
