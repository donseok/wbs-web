import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  emitNotification: vi.fn(),
  ensureOrderForWorkflowLeaf: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWbsAssignee, setWbsAssigneeCascade, setWbsStage, getWbsAssigneeStage } from '@/app/actions/wbsAssign'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
const W1 = '33333333-3333-4333-8333-333333333333'
const M1 = '44444444-4444-4444-8444-444444444444'
const M2 = '55555555-5555-4555-8555-555555555555'
const W2 = '66666666-6666-4666-8666-666666666666'
const W5 = '77777777-7777-4777-8777-777777777770'
const W6 = '88888888-8888-4888-8888-888888888880'

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
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.contains = (col: string, val: unknown) => {
        (captured[`${table}.contains`] ??= []).push([col, val]); return b
      }
      b.in = (col: string, val: unknown) => {
        (captured[`${table}.in`] ??= []).push([col, val]); return b
      }
      b.is = (col: string, val: unknown) => {
        (captured[`${table}.is`] ??= []).push([col, val]); return b
      }
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
  mocks.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: true })
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

  it('배정 성공 시 ensureOrderForWorkflowLeaf 1회 호출', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(1)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: P1, wbsItemId: W1, actorUserId: 'admin-1' }),
    )
  })

  it('해제(null)·no-op 시 ensureOrderForWorkflowLeaf 미호출', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } },
        { data: [{ id: W1 }] },
      ],
    })
    const r1 = await setWbsAssignee(W1, null)
    expect(r1.ok).toBe(true)
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()

    admin({
      wbs_items: [{ data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } }],
    })
    const r2 = await setWbsAssignee(W1, M1)
    expect(r2.ok).toBe(true)
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })

  it('ensureOrderForWorkflowLeaf 실패해도 setWbsAssignee 는 ok:true 유지', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.ensureOrderForWorkflowLeaf.mockRejectedValueOnce(new Error('boom'))
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('setWbsAssigneeCascade', () => {
  // 트리: W1(root, 미지정) → W2(미지정) → W6(리프, 미지정) / W1 → W5(이미 M2 배정, 리프)
  const TREE = [
    { id: W1, parent_id: null, name: 'Root', assignee_member_id: null },
    { id: W2, parent_id: W1, name: 'Child B', assignee_member_id: null },
    { id: W5, parent_id: W1, name: 'Child C', assignee_member_id: M2 },
    { id: W6, parent_id: W2, name: 'Grandchild D', assignee_member_id: null },
  ]

  it('(a) 미지정 하위만 갱신 — 이미 배정된 항목(W5)은 건너뛴다, 본인(W1)은 별도 무조건 UPDATE', async () => {
    const { captured } = admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: TREE },                              // 트리 read
        { data: [{ id: W1 }] },                       // 본인 UPDATE(.eq)
        { data: [{ id: W2 }, { id: W6 }] },            // 하위 UPDATE(.in + .is null)
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r).toEqual({ ok: true, count: 3 })
    const [, idsArg] = captured['wbs_items.in'][0] as [string, string[]]
    expect(new Set(idsArg)).toEqual(new Set([W2, W6]))
    expect(idsArg).not.toContain(W1) // 본인은 .in 이 아니라 별도 .eq UPDATE
    expect(idsArg).not.toContain(W5)
    expect(captured['wbs_items.is'][0]).toEqual(['assignee_member_id', null])
  })

  it('(b) 요약 알림 1건만 — 항목별 스팸 없음, detail 은 "외 N건" 요약', async () => {
    admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: TREE },
        { data: [{ id: W1 }] },
        { data: [{ id: W2 }, { id: W6 }] },
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.assigned',
      projectId: P1,
      entityId: W1,
      recipientMemberIds: [M1],
      payload: expect.objectContaining({
        detail: "'Root' 외 2건의 작업 담당자로 지정되었습니다",
      }),
    }))
  })

  it('(c) 새로 배정된 리프에만 ensureOrderForWorkflowLeaf 호출 — 자식 있는 노드(W1,W2)는 제외', async () => {
    admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: TREE },
        { data: [{ id: W1 }] },
        { data: [{ id: W2 }, { id: W6 }] },
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(1)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: P1, wbsItemId: W6, actorUserId: 'admin-1' }),
    )
  })

  it('(d) 하위 트리 조회 실패 시 중단 — 갱신·알림·주문 발행 모두 없음(부분 적용 강행 금지)', async () => {
    const { captured } = admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: null, error: { message: 'boom' } },
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })

  it('(e) 본인이 이미 다른 담당자면 본인은 갱신하되(단건 액션과 동일) 이미 배정된 하위는 건너뛴다', async () => {
    const { captured } = admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: [
          { id: W1, parent_id: null, name: 'Root', assignee_member_id: M2 },
          { id: W2, parent_id: W1, name: 'Child B', assignee_member_id: M2 },
        ] },
        { data: [{ id: W1 }] }, // 본인 UPDATE만 — 하위 후보 없음(전부 이미 배정) → 하위 UPDATE 호출 자체가 없다
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r).toEqual({ ok: true, count: 1 })
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ detail: "'Root' 작업 담당자로 지정되었습니다" }),
    }))
    expect(captured['wbs_items.is'] ?? []).toHaveLength(0) // 하위 UPDATE 없었음
  })

  it('(e2) 본인이 이미 같은 담당자이고 하위도 전부 배정 완료면 count:0, 무발행(진짜 no-op, UPDATE 자체를 안 함)', async () => {
    const { calls } = admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: [
          { id: W1, parent_id: null, name: 'Root', assignee_member_id: M1 },
          { id: W2, parent_id: W1, name: 'Child B', assignee_member_id: M2 },
        ] },
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r).toEqual({ ok: true, count: 0 })
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
    expect(calls.filter(t => t === 'wbs_items')).toHaveLength(1) // 트리 read 1회뿐, UPDATE 없음
  })

  it('(h) TOCTOU — 하위 후보였지만 실제 UPDATE(.is null)에서 걸러진 항목은 건수·알림·주문발행 모두에서 제외', async () => {
    // 후보는 [W2, W6] 이지만, 그 사이 다른 관리자가 W2 를 먼저 배정했다고 가정 —
    // .is('assignee_member_id', null) 조건에 걸려 DB는 W6 만 실제로 갱신했다고 응답한다.
    admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: TREE },
        { data: [{ id: W1 }] },
        { data: [{ id: W6 }] }, // W2 는 후보였지만 실제 갱신에서 빠짐
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r).toEqual({ ok: true, count: 2 }) // W1 + W6 만 — 후보 개수(W2,W6=2)가 아니라 실제 갱신 기준
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ detail: "'Root' 외 1건의 작업 담당자로 지정되었습니다" }),
    }))
    // W2 는 실제로 갱신되지 않았으므로 리프 자동주문 대상에서도 제외(부모 W1은 자식 있어 제외).
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledTimes(1)
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wbsItemId: W6 }),
    )
  })

  it('(i) 하위 UPDATE 자체가 실패해도 본인 반영분은 정직하게 커밋 처리 — ok:true+cascadeFailed:true(부분 커밋을 전체 실패로 위장하지 않는다, 리뷰 라운드 2)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: TREE },
        { data: [{ id: W1 }] }, // 본인 UPDATE 성공 — 이미 DB 에 커밋됨
        { data: null, error: { message: 'network boom' } }, // 하위 UPDATE 실패
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    // 본인 반영분(1건)은 정직하게 count 에 반영하고, 실패 사실은 cascadeFailed 로만 알린다 —
    // 이미 커밋된 쓰기를 ok:false 로 위장하지 않는다.
    expect(r).toEqual({ ok: true, count: 1, cascadeFailed: true })
    expect(errSpy).toHaveBeenCalled()
    // 본인 반영 기준으로 알림은 정상 발행(하위가 실패했으므로 "외 N건" 없이 단건 문구).
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      entityId: W1,
      payload: expect.objectContaining({ detail: "'Root' 작업 담당자로 지정되었습니다" }),
    }))
    // W1은 자식이 있어 리프가 아니므로 자동 주문 발행 대상이 아니다(하위는 실패해 갱신되지 않았음).
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('(j) 본인 갱신 대상이 없고 하위 UPDATE 만 실패하면 count:0 + cascadeFailed:true, 무발행', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin({
      project_members: [{ data: { id: M1, project_id: P1 } }],
      wbs_items: [
        { data: [
          { id: W1, parent_id: null, name: 'Root', assignee_member_id: M1 }, // 이미 같은 담당자 — 본인 UPDATE 없음
          { id: W2, parent_id: W1, name: 'Child B', assignee_member_id: null },
        ] },
        { data: null, error: { message: 'network boom' } }, // 하위 UPDATE(유일한 UPDATE) 실패
      ],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r).toEqual({ ok: true, count: 0, cascadeFailed: true })
    expect(errSpy).toHaveBeenCalled()
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('(f) 다른 프로젝트의 member_id → 거부, 조회 없음', async () => {
    const { captured } = admin({
      project_members: [{ data: { id: M1, project_id: P2 } }],
    })
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r.ok).toBe(false)
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('(g) 관리자 아님 → 거부, DB 접근 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { captured } = admin({})
    const r = await setWbsAssigneeCascade(W1, M1)
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.project_members ?? []).toHaveLength(0)
    expect(captured.wbs_items ?? []).toHaveLength(0)
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

  it('(a) fp→im 전이 시 depends 로 이 항목을 참조하는 후행 리프 담당자에게 work.unblocked 발행(미배정 후행은 건너뜀)', async () => {
    const W3 = '77777777-7777-4777-8777-777777777777'
    const { captured } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        { data: [
          { id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1'] },
          { id: W3, name: 'Task C', assignee_member_id: null, depends: ['mod/1'] }, // 미배정 후행 — 발행 대상 아님(선행 조회도 스킵)
        ] },
        { data: [{ external_ref: 'mod/1', stage: 'im' }] }, // W2 의 depends 전체(mod/1 단일) 도달 확인
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.unblocked',
      projectId: P1,
      actorUserId: 'admin-1',
      entityType: 'wbs_item',
      entityId: W2,
      recipientMemberIds: [M2],
      dedupeKey: `unblocked:${W2}:${W1}`,
    }))
    expect(captured['wbs_items.contains']).toEqual([['depends', ['mod/1']]])
  })

  it('(e) 후행의 depends 2개 중 하나만 im — 전체 미충족이라 무발행', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        { data: [{ id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1', 'mod/2'] }] },
        // mod/1(지금 im 도달) + mod/2(아직 fp) — 전체 미충족
        { data: [{ external_ref: 'mod/1', stage: 'im' }, { external_ref: 'mod/2', stage: 'fp' }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('(f) 후행의 depends 2개 중 마지막 선행이 im 도달 — 1회 발행', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        { data: [{ id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1', 'mod/2'] }] },
        // mod/1(지금 im 도달) + mod/2(이미 im) — 전체 충족, 이 전이에서 1회만 발행
        { data: [{ external_ref: 'mod/1', stage: 'im' }, { external_ref: 'mod/2', stage: 'im' }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.unblocked',
      entityId: W2,
      dedupeKey: `unblocked:${W2}:${W1}`,
    }))
  })

  it('depends 에 같은 external_ref 가 중복돼도 정상 발행(길이 대신 고유 개수로 비교)', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        { data: [{ id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1', 'mod/1'] } ] },
        // .in() 은 중복 없이 실제 존재하는 행만 1개 반환한다 — dependsRefs.length(2) 가 아니라
        // new Set(dependsRefs).size(1) 과 비교해야 여기서 통과한다.
        { data: [{ external_ref: 'mod/1', stage: 'im' }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.unblocked',
      entityId: W2,
      dedupeKey: `unblocked:${W2}:${W1}`,
    }))
  })

  it('후행 목록에 자기 자신(자기 참조 depends)이 있으면 건너뛴다 — 본인에게 알림 가지 않음', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        // 후행 조회가 자기 자신을 포함해 반환(자기 참조 depends) — 선행 확인 쿼리 없이 즉시 skip.
        { data: [{ id: W1, name: 'Task A', assignee_member_id: M1, depends: ['mod/1'] }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('(b) im→xx(이미 im 이상) 전이는 unblocked 무발행', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'im' } },
        { data: [{ id: W1 }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'xx')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('(c) 후행 리프가 없으면 무발행', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        { data: [] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('(d) 후행 조회 실패 시 발행 생략 + setWbsStage 는 ok:true 유지', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: 'mod/1' } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
        { data: null, error: { message: 'boom' } },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('external_ref 가 없으면 후행 조회 자체를 하지 않는다', async () => {
    const { calls } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1, external_ref: null } },
        { data: { stage: 'fp' } },
        { data: [{ id: W1 }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await setWbsStage(W1, 'im')
    expect(r.ok).toBe(true)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(calls.filter(t => t === 'wbs_items')).toHaveLength(3)
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
