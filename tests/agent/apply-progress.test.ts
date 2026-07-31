import { describe, expect, it, vi } from 'vitest'
import { applyAgentProgress } from '@/lib/agent/applyProgress'

type Resp = { data?: unknown; error?: { message: string } | null }
function admin(queues: Record<string, Resp[]>) {
  return {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'eq', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  } as never
}

const ITEM = { id: 'w1', actual_pct: 30, project_id: 'p1' }

describe('applyAgentProgress', () => {
  it('리프 항목이면 갱신 + change_logs 기록', async () => {
    const a = admin({
      wbs_items: [{ data: ITEM }, { data: null }, { data: [{ id: 'w1' }] }], // 항목, 자식 없음, update.select
      change_logs: [{ data: [{}] }],
    })
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 55, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, projectId: 'p1' })
  })
  it('동일값 재보고는 no-op — update·change_logs 없이 통과(wbs_items 큐 1건만 소비)', async () => {
    const a = admin({ wbs_items: [{ data: ITEM }] }) // 항목 조회만 소비, 자식 확인·update 는 없음
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 30, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, projectId: 'p1' })
    expect((a as unknown as { from: ReturnType<typeof vi.fn> }).from).toHaveBeenCalledTimes(1)
  })
  it('항목 조회 실패는 중단 — 없음으로 위장하지 않는다', async () => {
    const a = admin({ wbs_items: [{ data: null, error: { message: 'db down' } }] })
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 10, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('db down')
  })
  it('롤업 부모(자식 있음)는 거부', async () => {
    const a = admin({ wbs_items: [{ data: ITEM }, { data: { id: 'child' } }] })
    const r = await applyAgentProgress(a, { wbsItemId: 'w1', percent: 10, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
  })
  it('범위 밖 percent 거부', async () => {
    const a = admin({})
    expect((await applyAgentProgress(a, { wbsItemId: 'w1', percent: 100, actorUserId: 'u1' })).ok).toBe(false)
    expect((await applyAgentProgress(a, { wbsItemId: 'w1', percent: -1, actorUserId: 'u1' })).ok).toBe(false)
  })
})
