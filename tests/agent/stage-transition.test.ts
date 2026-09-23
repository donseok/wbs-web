import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '@/lib/minutes/externalApi'

const mocks = vi.hoisted(() => ({
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { notifySuccessorsOnReached } from '@/lib/agent/stageTransition'

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

describe('notifySuccessorsOnReached — 선행 실적 100 도 충족(스펙 2026-09-15 §3.7)', () => {
  it('다른 선행이 stage 없이 실적 100 이면 후행 담당자에게 unblocked 를 발행한다', async () => {
    const { admin } = useAdmin({
      wbs_items: [
        { data: [{ id: 'succ-1', name: '후행', assignee_member_id: 'm-1', depends: ['MES/A', 'MES/B'] }] },
        { data: [{ external_ref: 'MES/A', stage: 'im', actual_pct: 80 }, { external_ref: 'MES/B', stage: null, actual_pct: 100 }] },
      ],
    })
    await notifySuccessorsOnReached(admin, { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: 'MES/A' }, ACTOR)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'work.unblocked', entityId: 'succ-1' }))
  })
  it('다른 선행이 실적 99 에 stage 미달이면 발행하지 않는다', async () => {
    const { admin } = useAdmin({
      wbs_items: [
        { data: [{ id: 'succ-1', name: '후행', assignee_member_id: 'm-1', depends: ['MES/A', 'MES/B'] }] },
        { data: [{ external_ref: 'MES/A', stage: 'im', actual_pct: 80 }, { external_ref: 'MES/B', stage: 'ip', actual_pct: 99 }] },
      ],
    })
    await notifySuccessorsOnReached(admin, { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: 'MES/A' }, ACTOR)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })
})

describe('notifySuccessorsOnReached — 강제 진행 면제 간선(스펙 2026-09-23 F2)', () => {
  it('남은 미충족 선행이 면제 간선뿐이면 발행한다(면제 ref 는 조회하지 않는다)', async () => {
    const { admin } = useAdmin({
      wbs_items: [
        { data: [{ id: 'succ-1', name: '후행', assignee_member_id: 'm-1', depends: ['MES/A', 'MES/B'], depends_waived: ['MES/B'] }] },
        { data: [{ external_ref: 'MES/A', stage: 'im', actual_pct: 80 }] },
      ],
    })
    await notifySuccessorsOnReached(admin, { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: 'MES/A' }, ACTOR)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'work.unblocked', entityId: 'succ-1' }))
  })
  it('도달한 선행이 면제 간선이면 이미 착수 가능했으므로 다시 알리지 않는다', async () => {
    const { admin, fromCalls } = useAdmin({
      wbs_items: [
        { data: [{ id: 'succ-1', name: '후행', assignee_member_id: 'm-1', depends: ['MES/A'], depends_waived: ['MES/A'] }] },
      ],
    })
    await notifySuccessorsOnReached(admin, { id: ITEM_ID, project_id: PROJECT_ID, name: '항목', external_ref: 'MES/A' }, ACTOR)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(fromCalls).toEqual(['wbs_items'])
  })
})
