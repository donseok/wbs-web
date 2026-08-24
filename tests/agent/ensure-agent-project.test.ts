import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))

import { backfillProjectOrders, ensureAgentProject } from '@/lib/agent/ensureOrder'
import type { AdminClient } from '@/lib/minutes/externalApi'

type Resp = { data?: unknown; error?: { message: string; code?: string } | null }
/** 테이블별 응답 큐 — 호출 순서대로 소비. update/insert payload 는 captured 에 쌓인다. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  return { client: client as unknown as AdminClient, captured }
}
const P1 = 'project-1'

describe('ensureAgentProject — 자동 활성(위임 체크 = 발행)', () => {
  it('행 없음 → insert(enabled 기본 true), activated:true', async () => {
    const { client, captured } = admin({ agent_projects: [{ data: null }, { data: null }] })
    const r = await ensureAgentProject(client, { projectId: P1, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, enabled: true, activated: true, stopped: false })
    expect(captured.agent_projects[0]).toMatchObject({ project_id: P1, created_by: 'u1' })
  })
  it('이미 활성 → no-op', async () => {
    const { client, captured } = admin({ agent_projects: [{ data: { enabled: true } }] })
    const r = await ensureAgentProject(client, { projectId: P1, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, enabled: true, activated: false, stopped: false })
    expect(captured.agent_projects).toBeUndefined()
  })
  it('중지(enabled:false)된 프로젝트는 되살리지 않는다 — stopped:true', async () => {
    const { client, captured } = admin({ agent_projects: [{ data: { enabled: false } }] })
    const r = await ensureAgentProject(client, { projectId: P1, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, enabled: false, activated: false, stopped: true })
    expect(captured.agent_projects).toBeUndefined()
  })
  it('insert 23505 경합 → 재조회 결과로 보고(activated:false)', async () => {
    const { client } = admin({ agent_projects: [{ data: null }, { data: null, error: { message: 'dup', code: '23505' } }, { data: { enabled: true } }] })
    const r = await ensureAgentProject(client, { projectId: P1, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, enabled: true, activated: false, stopped: false })
  })
  it('조회 실패는 ok:false(미등록으로 위장 금지)', async () => {
    const { client } = admin({ agent_projects: [{ data: null, error: { message: 'boom' } }] })
    const r = await ensureAgentProject(client, { projectId: P1, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
  })
})

describe('backfillProjectOrders — 활성 시점 소급 발행', () => {
  it('dev_workflow 리프마다 주문 보장 — 생성 수 집계, 개별 실패는 failed 로 모으고 계속', async () => {
    // wbs_items: 백필 대상 3건. 이후 ensureOrderForWorkflowLeaf 가 항목마다 agent_projects→wbs_items→wbs_items(child)→orders→insert 순으로 읽는다.
    const { client } = admin({
      wbs_items: [
        { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        // a: 항목 조회 → 리프 → 발행
        { data: { name: 'A', priority: 'high', external_ref: 'm/A', assignee_member_id: null, dev_workflow: true } }, { data: null },
        // b: 항목 조회 실패 → failed
        { data: null, error: { message: 'boom' } },
        // c: 항목 조회 → 자식 있음(리프 아님) → skip
        { data: { name: 'C', priority: null, external_ref: 'm/C', assignee_member_id: null, dev_workflow: true } }, { data: { id: 'child' } },
      ],
      agent_projects: [{ data: { enabled: true } }, { data: { enabled: true } }, { data: { enabled: true } }],
      agent_work_orders: [{ data: null }, { data: { id: 'o-a' } }],
    })
    const r = await backfillProjectOrders(client, { projectId: P1, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, created: 1, failed: ['b'] })
  })
  it('대상 조회 실패는 ok:false', async () => {
    const { client } = admin({ wbs_items: [{ data: null, error: { message: 'boom' } }] })
    const r = await backfillProjectOrders(client, { projectId: P1, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
  })
})
