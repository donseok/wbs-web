import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  emitNotification: vi.fn(),
  ensureOrderForAssignedLeaf: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForAssignedLeaf: mocks.ensureOrderForAssignedLeaf }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWbsAssignee, setWbsStage, getWbsAssigneeStage } from '@/app/actions/wbsAssign'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
const W1 = '33333333-3333-4333-8333-333333333333'
const M1 = '44444444-4444-4444-8444-444444444444'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 큐 기반 admin 목 — 테이블별 순차 응답 + insert/update payload 캡처 + 호출된 테이블 목록. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const calls: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { captured, calls }
}

const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  mocks.requireProjectMember.mockResolvedValue(ACTOR)
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.emitNotification.mockResolvedValue({ ok: true, recipients: 1 })
  mocks.ensureOrderForAssignedLeaf.mockResolvedValue({ ok: true, created: true })
})

describe('setWbsAssignee', () => {
  it('관리자 + 같은 프로젝트 로스터 멤버 → 갱신 성공', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(captured.wbs_items[0]).toMatchObject({ assignee_member_id: M1 })
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.assigned',
      recipientMemberIds: [M1],
    }))
  })

  it('다른 프로젝트의 member_id → 거부', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } }],
      project_members: [{ data: { id: M1, project_id: P2 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('관리자 아님 → 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { captured } = admin({
      wbs_items: [{ data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(captured.project_members ?? []).toHaveLength(0)
  })

  it('이미 같은 담당자면 쓰기·알림 없이 성공(no-op) — dedupeKey 대신 상태 비교로 멱등', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('null 배정 해제 성공 — 활성 주문은 자동 취소하지 않는다(§2.8 역방향)', async () => {
    const { captured, calls } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } },
        { data: [{ id: W1 }] },
      ],
    })
    const r = await setWbsAssignee(W1, null)
    expect(r.ok).toBe(true)
    expect(captured.wbs_items[0]).toMatchObject({ assignee_member_id: null })
    expect(calls).not.toContain('agent_work_orders')
    expect(calls).not.toContain('project_members')
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('배정 성공 시 ensureOrderForAssignedLeaf 1회 호출', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.ensureOrderForAssignedLeaf).toHaveBeenCalledTimes(1)
    expect(mocks.ensureOrderForAssignedLeaf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: P1, wbsItemId: W1, actorUserId: 'admin-1' }),
    )
  })

  it('해제(null)·no-op 시 ensureOrderForAssignedLeaf 미호출', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } },
        { data: [{ id: W1 }] },
      ],
    })
    const r1 = await setWbsAssignee(W1, null)
    expect(r1.ok).toBe(true)
    expect(mocks.ensureOrderForAssignedLeaf).not.toHaveBeenCalled()

    admin({
      wbs_items: [{ data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } }],
    })
    const r2 = await setWbsAssignee(W1, M1)
    expect(r2.ok).toBe(true)
    expect(mocks.ensureOrderForAssignedLeaf).not.toHaveBeenCalled()
  })

  it('ensureOrderForAssignedLeaf 실패해도 setWbsAssignee 는 ok:true 유지', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.ensureOrderForAssignedLeaf.mockRejectedValueOnce(new Error('boom'))
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.ensureOrderForAssignedLeaf).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('setWbsStage', () => {
  it('유효 stage 갱신 + change_logs 기록', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: { stage: null } },
        { data: [{ id: W1 }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'ip')
    expect(r.ok).toBe(true)
    expect(captured.change_logs[0]).toMatchObject({ field: 'stage', old_value: null, new_value: 'ip' })
  })

  it('허용 밖 문자열 거부', async () => {
    const { calls } = admin({})
    const r = await setWbsStage(W1, 'dd' as never)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('getWbsAssigneeStage', () => {
  it('같은 프로젝트 멤버 + 조회 성공 → 현재 값 반환', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    mocks.createServerClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { assignee_member_id: M1, stage: 'ip' }, error: null }),
          }),
        }),
      }),
    })
    const r = await getWbsAssigneeStage(W1)
    expect(mocks.resolveProjectId).toHaveBeenCalledWith('wbs_items', W1)
    expect(mocks.requireProjectMember).toHaveBeenCalledWith(P1)
    expect(r).toEqual({ assigneeMemberId: M1, stage: 'ip' })
  })

  it('이 프로젝트 멤버가 아니면 거부 → null(조회 자체를 하지 않는다)', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const r = await getWbsAssigneeStage(W1)
    expect(r).toBeNull()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('소속 프로젝트 조회 실패 → null(미배정으로 위장하지 않는다)', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const r = await getWbsAssigneeStage(W1)
    expect(r).toBeNull()
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })

  it('멤버 확인 통과 후 값 조회 실패 → null(미배정으로 위장하지 않는다)', async () => {
    mocks.createServerClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    })
    const r = await getWbsAssigneeStage(W1)
    expect(r).toBeNull()
  })
})
