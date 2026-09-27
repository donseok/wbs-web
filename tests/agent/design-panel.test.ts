// tests/agent/design-panel.test.ts — WBS 작업 패널의 설계 영역 재료(설계 상태 스펙 3절·7절). designGate 판정은 실제 함수를 쓴다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadItemFacts: vi.fn() }))
vi.mock('@/lib/agent/designFacts', async (orig) => ({ ...(await orig<typeof import('@/lib/agent/designFacts')>()), loadItemFacts: mocks.loadItemFacts }))

import { designPanelOf, loadDesignTarget } from '@/lib/agent/designPanel'
import type { ItemFacts } from '@/lib/domain/designGate'

const W1 = '33333333-3333-4333-8333-333333333333'
const O1 = '44444444-4444-4444-8444-444444444444'
type Resp = { data?: unknown; error?: { message: string } | null }
/** 테이블별 순차 응답 흉내 — select/eq/in/order/limit 체인 뒤 maybeSingle 또는 thenable. */
function admin(queues: Record<string, Resp[]>) {
  return { from: vi.fn((table: string) => {
    const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
    b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
    return b
  }) } as never
}
const ITEM = { id: W1, project_id: 'p1', external_ref: 'm/TSK-01-01', stage: 'dd', actual_pct: 20, tags: ['agent'], depends: [], depends_waived: [], design_mode: 'review' }
const facts = (f: Partial<ItemFacts> = {}): ItemFacts => ({ mode: 'review', stage: 'dd', actualPct: 20, delegated: true, hasApprovedOrder: false, preds: 'met', ...f })
const CLAIMED_REVIEW = { id: O1, status: 'claimed', claimed_by: 'a/b/w1', claimed_by_user_id: 'u1', last_heartbeat_at: null,
  heartbeat_phase: 'wait_review', heartbeat_agent: 'a/b/w1', design_state: 'review', claim_scope: 'design', design_note: '빠진 절: 테스트 전략', runner: null, runner_seen_at: null }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadItemFacts.mockResolvedValue(new Map([[W1, { facts: facts(), depsUnmet: [] }]]))
})

describe('loadDesignTarget', () => {
  it('항목·활성 주문·마지막 검토·판단 재료를 모은다', async () => {
    const t = await loadDesignTarget(admin({
      wbs_items: [{ data: ITEM }],
      agent_work_orders: [{ data: [{ id: 'old', status: 'cancelled' }, { ...CLAIMED_REVIEW }] }],
      agent_work_reports: [{ data: { review_action: 'reject' } }],
    }), W1)
    expect(t).toMatchObject({ itemId: W1, projectId: 'p1', item: facts(), orderStatuses: ['cancelled', 'claimed'], lastReview: 'reject' })
    expect(t?.active).toMatchObject({ id: O1, status: 'claimed', designState: 'review', designNote: '빠진 절: 테스트 전략' })
    expect(mocks.loadItemFacts).toHaveBeenCalledWith(expect.anything(), [ITEM])
  })
  it('활성 주문(ready·claimed·reported)이 없으면 active·lastReview 는 null — 승인·취소된 주문은 활성이 아니다', async () => {
    const t = await loadDesignTarget(admin({
      wbs_items: [{ data: ITEM }],
      agent_work_orders: [{ data: [{ id: 'a1', status: 'approved' }, { id: 'c1', status: 'cancelled' }] }],
    }), W1)
    expect(t).toMatchObject({ active: null, lastReview: null, orderStatuses: ['approved', 'cancelled'] })
  })
  it('항목이 없으면 null, 조회 실패는 throw(없음으로 위장하지 않는다)', async () => {
    expect(await loadDesignTarget(admin({ wbs_items: [{ data: null }] }), W1)).toBeNull()
    await expect(loadDesignTarget(admin({ wbs_items: [{ error: { message: 'db' } }] }), W1)).rejects.toThrow('항목 조회 실패')
    await expect(loadDesignTarget(admin({ wbs_items: [{ data: ITEM }], agent_work_orders: [{ error: { message: 'db' } }] }), W1))
      .rejects.toThrow('주문 조회 실패')
    await expect(loadDesignTarget(admin({
      wbs_items: [{ data: ITEM }], agent_work_orders: [{ data: [CLAIMED_REVIEW] }], agent_work_reports: [{ error: { message: 'db' } }],
    }), W1)).rejects.toThrow('보고 조회 실패')
    mocks.loadItemFacts.mockRejectedValueOnce(new Error('선행 항목 조회 실패: db'))
    await expect(loadDesignTarget(admin({ wbs_items: [{ data: ITEM }], agent_work_orders: [{ data: [] }] }), W1)).rejects.toThrow('선행 항목 조회 실패')
  })
})

describe('designPanelOf', () => {
  const base = { itemId: W1, projectId: 'p1', lastReview: null as null }
  it('설계 검토 대기 — 1행 문구·사유, 「설계 승인」 버튼, 방식 잠금', () => {
    const p = designPanelOf({ ...base, item: facts(), orderStatuses: ['claimed'],
      active: { id: O1, status: 'claimed', designState: 'review', runner: null, lastHeartbeatAt: null, heartbeatPhase: 'wait_review', designNote: '빠진 절: 테스트 전략' } }, Date.now())
    expect(p.screen).toMatchObject({ row: 1, label: '설계 검토 대기', note: '빠진 절: 테스트 전략' })
    expect(p.buttons).toEqual(['accept'])
    expect(p.modeLock).toMatch(/설계가/)
    expect(p.designState).toBe('review')
    expect(p.mode).toBe('review')
  })
  it('구현자동 ready — 6행과 「설계 확정」, 방식은 바꿀 수 있다', () => {
    const p = designPanelOf({ ...base, item: facts({ mode: 'human', stage: 'as', actualPct: 0 }), orderStatuses: ['ready'],
      active: { id: O1, status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null } }, Date.now())
    expect(p.screen?.row).toBe(6)
    expect(p.buttons).toEqual(['confirm'])
    expect(p.modeLock).toBeNull()
  })
  it('승인된 설계로 구현 중 — push 경고(Y13), 버튼 없음', () => {
    const p = designPanelOf({ ...base, item: facts({ stage: 'ip', actualPct: 50 }), orderStatuses: ['claimed'],
      active: { id: O1, status: 'claimed', designState: 'accepted', runner: 'a/b/w1', lastHeartbeatAt: new Date().toISOString(), heartbeatPhase: 'build', designNote: null } }, Date.now())
    expect(p.pushWarning).toMatch(/agent 브랜치에 push 하지 마세요/)
    expect(p.buttons).toEqual([])
  })
  it('어느 행에도 맞지 않으면 screen 은 null(단계 문구 그대로) — 완전자동 대기 주문', () => {
    const p = designPanelOf({ ...base, item: facts({ mode: 'auto', stage: 'as', actualPct: 0 }), orderStatuses: ['ready'],
      active: { id: O1, status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null } }, Date.now())
    expect(p).toEqual({ mode: 'auto', designState: null, screen: null, buttons: [], pushWarning: null, modeLock: null })
  })
})
