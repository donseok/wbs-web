// 판단 재료 일괄 로더 — 항목의 approved 주문·선행 도달을 배치로 구해 designGate 입력을 만든다.
import { describe, expect, it, vi } from 'vitest'
import { decide, designFieldsOf, hasApprovedOrder, loadItemFacts, orderFactsOf, responseMine } from '@/lib/agent/designFacts'

type Resp = { data?: unknown; error?: { message: string } | null }
function useAdmin(queues: Record<string, Resp[]>) {
  const calls: Array<{ table: string; cols?: string }> = []
  return {
    calls,
    client: {
      from: vi.fn((table: string) => {
        const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
        const b: Record<string, unknown> = {}
        b.select = (cols: string) => { calls.push({ table, cols }); return b }
        for (const k of ['eq', 'in', 'limit', 'order']) b[k] = () => b
        b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
        return b
      }),
    } as never,
  }
}
const NOW = Date.parse('2026-09-27T12:00:00Z')

describe('orderFactsOf', () => {
  it('빈 값은 legacy·없음으로 정규화한다', () => {
    expect(orderFactsOf({ status: 'claimed', claimed_by: 'a/b/w1', claimed_by_user_id: 'u', last_heartbeat_at: null, heartbeat_phase: null,
      heartbeat_agent: null, design_state: null, claim_scope: null, runner: 'a/b/w1', runner_seen_at: null }))
      .toMatchObject({ status: 'claimed', claimScope: 'legacy', designState: null, runner: 'a/b/w1' })
  })
})

describe('responseMine — 응답의 mine(계약 2.11)', () => {
  // last_heartbeat_at·heartbeat_phase 는 선택 칸이다(routeShared.OrderRow 처럼 열이 없는 행도 받는다).
  const row = { status: 'reported', claimed_by: 'hong/mbp/w1', claimed_by_user_id: 'u', design_state: null, claim_scope: 'full',
    runner: 'hong/pc2/w1', runner_seen_at: new Date(NOW - 60_000).toISOString() }
  const req = { userId: 'u', label: 'hong/mbp/lead', lead: false, filtersPass: true }
  it('reported·approved 는 종전 뜻(점유 사용자 일치) — 도는 PC 와 무관하다(merge-conflict.md 가 기댄다)', () => {
    expect(responseMine(orderFactsOf(row), req, NOW)).toBe(true)
    expect(responseMine(orderFactsOf({ ...row, status: 'approved' }), req, NOW)).toBe(true)
    expect(responseMine(orderFactsOf(row), { ...req, userId: 'other' }, NOW)).toBe(false)
  })
  it('claimed 는 5.3 정의 — 다른 PC 가 30분 안에 신호를 냈으면 거짓, 같은 PC 면 참', () => {
    expect(responseMine(orderFactsOf({ ...row, status: 'claimed' }), req, NOW)).toBe(false)
    expect(responseMine(orderFactsOf({ ...row, status: 'claimed', runner: 'hong/mbp/w1' }), req, NOW)).toBe(true)
  })
  it('라벨 없는(팀장 아닌) 요청의 claimed 는 종전 뜻 — 옛 킷 호환(최종 리뷰 Important 2), 팀장 요청은 5.3 그대로', () => {
    const claimed = orderFactsOf({ ...row, status: 'claimed' })
    expect(responseMine(claimed, { ...req, label: null }, NOW)).toBe(true)
    expect(responseMine(claimed, { ...req, label: null, userId: 'other' }, NOW)).toBe(false)
    expect(responseMine(claimed, { ...req, label: null, lead: true }, NOW)).toBe(false) // 팀장 거르기는 라벨 없이도 건너뛰지 않는다
  })
})

describe('loadItemFacts', () => {
  it('항목의 approved 주문과 선행 도달을 배치로 구한다', async () => {
    const { client } = useAdmin({
      agent_work_orders: [{ data: [{ wbs_item_id: 'w1' }] }, { data: [{ wbs_item_id: 'p2' }] }],
      wbs_items: [{ data: [
        { id: 'p1', project_id: 'P', external_ref: 'M/TSK-01-01', stage: 'ip', actual_pct: 30 },
        { id: 'p2', project_id: 'P', external_ref: 'M/TSK-01-02', stage: 'as', actual_pct: 0 },
      ] }],
    })
    const m = await loadItemFacts(client, [
      { id: 'w1', project_id: 'P', external_ref: 'M/TSK-01-03', stage: 'as', actual_pct: 0, tags: ['agent'], depends: ['M/TSK-01-01'], depends_waived: [], design_mode: 'review' },
      { id: 'w2', project_id: 'P', external_ref: 'M/TSK-01-04', stage: 'as', actual_pct: 0, tags: [], depends: ['M/TSK-01-02', 'M/TSK-01-09'], depends_waived: ['M/TSK-01-09'], design_mode: null },
    ])
    expect(m.get('w1')).toEqual({ facts: { mode: 'review', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: true, preds: 'ahead' }, depsUnmet: [{ external_ref: 'M/TSK-01-01', stage: 'ip' }] })
    // p2 는 approved 주문이 있어 도달, TSK-01-09 는 면제
    expect(m.get('w2')).toEqual({ facts: { mode: 'auto', stage: 'as', actualPct: 0, delegated: false, hasApprovedOrder: false, preds: 'met' }, depsUnmet: [] })
  })
  it('항목이 없으면 조회하지 않는다', async () => {
    const { client, calls } = useAdmin({})
    expect((await loadItemFacts(client, [])).size).toBe(0)
    expect(calls).toEqual([])
  })
  it('조회 실패는 throw(위장하지 않는다)', async () => {
    const { client } = useAdmin({ agent_work_orders: [{ error: { message: 'boom' } }] })
    await expect(loadItemFacts(client, [{ id: 'w1', project_id: 'P', external_ref: null, stage: 'as', actual_pct: 0, tags: [], depends: [], depends_waived: [], design_mode: 'auto' }]))
      .rejects.toThrow('boom')
  })
})

describe('decide·designFieldsOf·hasApprovedOrder', () => {
  it('항목이 지워진 주문은 skip', () => {
    const o = orderFactsOf({ status: 'ready', claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: null, runner: null, runner_seen_at: null })
    expect(decide(null, o, NOW)).toEqual({ action: 'skip', reason: '항목이 지워진 주문', depsUnmet: false })
  })
  it('응답 칸을 snake_case 로 싣는다', () => {
    expect(designFieldsOf(
      { design_state: 'review', claim_scope: 'design', design_note: 'x', runner: null, runner_seen_at: null },
      'review', { action: 'wait', reason: '설계 검토 대기', depsUnmet: false }, true,
    )).toEqual({ design_mode: 'review', design_state: 'review', design_note: 'x', claim_scope: 'design', runner: null, runner_seen_at: null,
      action: 'wait', action_reason: '설계 검토 대기', deps_unmet: false, mine: true })
  })
  it('hasApprovedOrder 는 한 건 조회', async () => {
    const { client } = useAdmin({ agent_work_orders: [{ data: { id: 'o' } }] })
    expect(await hasApprovedOrder(client, 'w1')).toBe(true)
  })
})
