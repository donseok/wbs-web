import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '@/lib/minutes/externalApi'

const mocks = vi.hoisted(() => ({
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { transitionStage, REACHED_STAGES } from '@/lib/agent/stageTransition'

type Resp = { data?: unknown; error?: { message: string } | null }

/**
 * 테이블별 큐 체이닝 mock — tests/agent/depends-gate.test.ts 의 useAdmin 패턴을 그대로 따른다.
 * from(table) 호출 시 해당 테이블 큐의 다음 응답을 소비하고, 체이닝 메서드는 자신을 반환하다가
 * maybeSingle()/then() 에서 그 응답을 반환한다. insert 페이로드는 별도로 기록한다.
 */
function useAdmin(queues: Record<string, Resp[]>) {
  const insertCalls: Array<{ table: string; payload: Record<string, unknown> }> = []
  const fromCalls: string[] = []
  const eqCalls: Array<[string, unknown]> = []
  const isCalls: Array<[string, unknown]> = []
  const admin = {
    from: vi.fn((table: string) => {
      fromCalls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'in', 'contains', 'limit', 'order']) b[k] = () => b
      b.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return b }
      b.is = (col: string, val: unknown) => { isCalls.push([col, val]); return b }
      b.insert = (payload: Record<string, unknown>) => {
        insertCalls.push({ table, payload })
        return b
      }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  } as unknown as AdminClient
  return { admin, insertCalls, fromCalls, eqCalls, isCalls }
}

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR = 'u-1'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('transitionStage', () => {
  it('dev_workflow=false → UPDATE 없이 transitioned:false', async () => {
    const { admin, fromCalls } = useAdmin({
      wbs_items: [{
        data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: 'as', dev_workflow: false },
      }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'fp', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: false, skipped: 'dev_workflow' })
    expect(fromCalls).toEqual(['wbs_items']) // UPDATE 호출 없음(조회 1회뿐)
  })

  // 승인은 사람의 명시 결정이라 항목 플래그가 무를 수 없다 — 이 게이트가 조용히 막아
  // "승인됐는데 stage 는 그대로"인 반쪽 상태가 세 번 재발했다(2026-08-25).
  it('dev_workflow=false + force → 게이트를 넘어 실제 전이', async () => {
    const { admin, fromCalls } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: 'fp', dev_workflow: false } },
        { data: [{ id: ITEM_ID }] },
      ],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'xx', actorUserId: ACTOR, force: true })
    expect(result.transitioned).toBe(true)
    expect(fromCalls.length).toBeGreaterThan(1) // UPDATE 까지 갔다
  })

  it("fromIn=['as','fp',null] 인데 현재 'ip' → no-op", async () => {
    const { admin, fromCalls } = useAdmin({
      wbs_items: [{
        data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: 'ip', dev_workflow: true },
      }],
    })
    const result = await transitionStage(admin, {
      itemId: ITEM_ID, to: 'im', fromIn: ['as', 'fp', null], actorUserId: ACTOR,
    })
    expect(result).toEqual({ ok: true, transitioned: false, skipped: 'stage' })
    expect(fromCalls).toEqual(['wbs_items'])
  })

  it("null→'as' 전이 시 change_logs insert payload {field:'stage', old_value:null, new_value:'as'}", async () => {
    const { admin, insertCalls } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: null, dev_workflow: true } },
        { data: [{ id: ITEM_ID }] }, // UPDATE 성공
      ],
      change_logs: [{ data: { id: 'cl-1' }, error: null }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'as', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: true })
    expect(insertCalls).toEqual([
      { table: 'change_logs', payload: { user_id: ACTOR, wbs_item_id: ITEM_ID, field: 'stage', old_value: null, new_value: 'as' } },
    ])
  })

  it("'ip'→'im' 전이 시 notifySuccessorsOnReached 경로의 후행 조회가 호출됨", async () => {
    const REF = 'MES/TSK-01-00'
    const { admin, fromCalls } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: REF, stage: 'ip', dev_workflow: true } },
        { data: [{ id: ITEM_ID }] }, // UPDATE 성공
        { data: [{ id: 'succ-1', name: '후행', assignee_member_id: 'm-1', depends: [REF] }] }, // 후행 조회(contains)
        { data: [{ external_ref: REF, stage: 'im' }] }, // allPredecessorsReached 조회
      ],
      change_logs: [{ data: { id: 'cl-1' }, error: null }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'im', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: true })
    // 조회(1) + UPDATE(2) + 후행 조회(3) + 선행 확인(4) — notifySuccessorsOnReached 경로가 실제로 탔다.
    expect(fromCalls).toEqual(['wbs_items', 'wbs_items', 'change_logs', 'wbs_items', 'wbs_items'])
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.unblocked',
      entityId: 'succ-1',
    }))
  })

  it("'im'→'xx' 전이(재도달)는 notifySuccessorsOnReached 를 다시 호출하지 않는다 — \"처음 도달\"만", async () => {
    const { admin } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: 'REF-1', stage: 'im', dev_workflow: true } },
        { data: [{ id: ITEM_ID }] }, // UPDATE 성공
      ],
      change_logs: [{ data: { id: 'cl-1' }, error: null }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'xx', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: true })
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('조회 에러 시 ok:false', async () => {
    const { admin } = useAdmin({
      wbs_items: [{ data: null, error: { message: 'db down' } }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'as', actorUserId: ACTOR })
    expect(result).toEqual({ ok: false, transitioned: false })
  })

  it('UPDATE 에 stage CAS 술어 포함 — oldStage 있으면 eq(stage, oldStage) (F4, 최종 리뷰)', async () => {
    const { admin, eqCalls } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: 'ip', dev_workflow: true } },
        { data: [{ id: ITEM_ID }] }, // UPDATE 성공
      ],
      change_logs: [{ data: { id: 'cl-1' }, error: null }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'im', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: true })
    expect(eqCalls).toContainEqual(['stage', 'ip'])
  })

  it('UPDATE 에 stage CAS 술어 포함 — oldStage null 이면 is(stage, null) (F4, 최종 리뷰)', async () => {
    const { admin, isCalls } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: null, dev_workflow: true } },
        { data: [{ id: ITEM_ID }] }, // UPDATE 성공
      ],
      change_logs: [{ data: { id: 'cl-1' }, error: null }],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'as', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: true })
    expect(isCalls).toContainEqual(['stage', null])
  })

  it('UPDATE 가 0행(경합에서 짐) → ok:true·transitioned:false, change_logs 미기록, 에러 로그 없음 (F4, 최종 리뷰)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin, insertCalls } = useAdmin({
      wbs_items: [
        { data: { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: null, stage: 'ip', dev_workflow: true } },
        { data: [] }, // UPDATE 0행 — 다른 경로가 먼저 stage 를 바꿨다
      ],
    })
    const result = await transitionStage(admin, { itemId: ITEM_ID, to: 'im', actorUserId: ACTOR })
    expect(result).toEqual({ ok: true, transitioned: false })
    expect(insertCalls.filter(c => c.table === 'change_logs')).toHaveLength(0)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('REACHED_STAGES', () => {
  it("im·xx 만 포함", () => {
    expect(REACHED_STAGES.has('im')).toBe(true)
    expect(REACHED_STAGES.has('xx')).toBe(true)
    expect(REACHED_STAGES.has('ip')).toBe(false)
  })
})
