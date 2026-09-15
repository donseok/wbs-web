import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  emitNotification: vi.fn(),
  ensureOrderForWorkflowLeaf: vi.fn(),
  applyWorkflowEvent: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
  viewerEmail: vi.fn(),
  myMemberIds: vi.fn(),
  isSubtreeManager: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// setWbsStage 는 requireSubtreeManagerOrAdmin(subtreeManager.ts, 실제 모듈, 트랙 B 2026-09-15)로
// 관리자 아닌 경로를 판정한다 — 그 내부가 부르는 viewerEmail·myMemberIds·isSubtreeManager 만 목킹한다.
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds, isSubtreeManager: mocks.isSubtreeManager }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf }))
// 전이 RPC 래퍼(applyWorkflowEvent)만 목킹하고 notifyOnReached 는 실제 구현을 쓴다 — setWbsStage 의
// 도달 알림은 RPC 결과(reachedFirst)를 보고 그 실제 경로(후행 조회·선행 전체 충족 게이트)를 탄다.
vi.mock('@/lib/agent/workflowEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent/workflowEvent')>()
  return { ...actual, applyWorkflowEvent: mocks.applyWorkflowEvent }
})
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWbsAssignee, setWbsAssigneeCascade, setWbsStage, getWbsAssigneeStage } from '@/app/actions/wbsAssign'
import { REASON_TEXT } from '@/lib/agent/workflowEvent'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
const W1 = '33333333-3333-4333-8333-333333333333'
const M1 = '44444444-4444-4444-8444-444444444444'
const M2 = '55555555-5555-4555-8555-555555555555'
const W2 = '66666666-6666-4666-8666-666666666666'
const W5 = '77777777-7777-4777-8777-777777777770'
const W6 = '88888888-8888-4888-8888-888888888880'

type Resp = { data?: unknown; error?: { message: string } | null }
/** 전이 RPC 래퍼의 성공 결과 기본값 — 부수효과(스냅샷·도달 알림) 없음. 케이스마다 덮는다. */
const WF_OK = { ok: true as const, orderStatus: null, stage: null, actualPct: null, stageChanged: false, actualChanged: false, reachedFirst: false, skipped: null }

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
  mocks.applyWorkflowEvent.mockResolvedValue(WF_OK)
  // 서브트리 관리자 경로 기본값(트랙 B) — 안전한 쪽("아니다")으로 두고, 개별 테스트가 override.
  mocks.viewerEmail.mockResolvedValue('member@example.com')
  mocks.myMemberIds.mockResolvedValue([])
  mocks.isSubtreeManager.mockResolvedValue(false)
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

  it('(a) 배정 성공 시 전이 RPC 를 assign 사건으로 호출(stage null 판정은 RPC 몫)', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'assign', actorUserId: 'admin-1', itemId: W1 })
  })

  it('(b) 배정 해제 시 전이 RPC 를 unassign 사건으로 호출(as 일 때만 null 은 RPC 몫)', async () => {
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A', assignee_member_id: M1 } },
        { data: [{ id: W1 }] },
      ],
    })
    const r = await setWbsAssignee(W1, null)
    expect(r.ok).toBe(true)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'unassign', actorUserId: 'admin-1', itemId: W1 })
  })

  it('(c) 전이 RPC 가 throw 해도 setWbsAssignee 는 ok:true 유지', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.applyWorkflowEvent.mockRejectedValueOnce(new Error('boom'))
    admin({
      wbs_items: [
        { data: { id: W1, project_id: P1, parent_id: null, name: 'Task A' } },
        { data: [{ id: W1 }] },
      ],
      project_members: [{ data: { id: M1, project_id: P1 } }],
    })
    const r = await setWbsAssignee(W1, M1)
    expect(r.ok).toBe(true)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
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

  it('(k) 실제 갱신된 모든 항목(리프 아닌 것 포함)에 assign 사건 — 리프 판정은 RPC 몫', async () => {
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
    // W1(부모, 자식 있음)·W2(부모)·W6(리프) 전부에 사건을 보낸다 — 리프가 아니면 RPC 가 skipped:'parent' 로 건너뛴다.
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledTimes(3)
    for (const id of [W1, W2, W6]) {
      expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'assign', actorUserId: 'admin-1', itemId: id })
    }
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
  // 자격: 관리자 또는 서브트리 관리자(트랙 B, 2026-09-15) — requireSubtreeManagerOrAdmin.
  // 리프 게이트·잠금(위임됨 ∨ 주문 claimed·reported)·크레딧·change_logs 는 원자 전이 RPC(0096)가 판정하므로
  // 여기서는 사건 인자·거부 문구 전달·부수효과(스냅샷·도달 알림)를 본다. RPC 판정 자체는 스테이징 리허설과
  // tests/migrations/0096 이 검증한다.
  describe('자격 — 관리자 아닐 때', () => {
    beforeEach(() => { mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' }) })
    it('멤버지만 서브트리 관리자가 아니면 거부, DB 접근·전이 없음', async () => {
      mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
      const { calls } = admin({})
      const r = await setWbsStage(W1, 'ip')
      expect(r).toEqual({ ok: false, error: '관리자 또는 서브트리 관리자만 할 수 있습니다.' })
      expect(calls).toHaveLength(0)
      expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
    })
    it('멤버도 아니면 그 가드 오류 그대로', async () => {
      mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
      expect(await setWbsStage(W1, 'ip')).toEqual({ ok: false, error: '멤버 아님' })
    })
    it('서브트리 관리자(strict 조상의 담당자)면 허용 — 전이도 그 사용자로 실행돼 change_logs.user_id 가 된다', async () => {
      mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
      mocks.myMemberIds.mockResolvedValue(['anc-member'])
      mocks.isSubtreeManager.mockResolvedValue(true)
      admin({})
      const r = await setWbsStage(W1, 'ip')
      expect(r.ok).toBe(true)
      expect(mocks.isSubtreeManager).toHaveBeenCalledWith(
        expect.anything(), { itemId: W1, projectId: P1, myMemberIds: ['anc-member'] },
      )
      expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'set_stage', actorUserId: 'anc-1', itemId: W1, stage: 'ip' })
    })
    it('조상 조회(isSubtreeManager)가 throw 하면 거부 — fail-closed', async () => {
      mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
      mocks.myMemberIds.mockResolvedValue(['anc-member'])
      mocks.isSubtreeManager.mockRejectedValue(new Error('조상 조회 실패: boom'))
      const { calls } = admin({})
      const r = await setWbsStage(W1, 'ip')
      expect(r.ok).toBe(false)
      expect(calls).toHaveLength(0)
      expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
    })
  })

  it('유효 단계 지정 → set_stage 사건 한 번(리프·잠금·크레딧·change_logs 는 RPC 가 한 트랜잭션으로)', async () => {
    const { calls } = admin({})
    const r = await setWbsStage(W1, 'ip')
    expect(r).toEqual({ ok: true })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'set_stage', actorUserId: 'admin-1', itemId: W1, stage: 'ip' })
    expect(calls).toHaveLength(0) // 앱이 wbs_items·change_logs 를 직접 쓰지 않는다
  })

  it('해제(null)도 set_stage 사건으로 넘긴다 — 잘못 찍힌 값을 지울 길', async () => {
    admin({})
    expect(await setWbsStage(W1, null)).toEqual({ ok: true })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'set_stage', actorUserId: 'admin-1', itemId: W1, stage: null })
  })

  it.each([
    ['parent', /최종단계/],
    ['locked', /위임을 끄세요/],
    ['not_workflow', /개발 워크플로 대상/],
  ])('RPC 가 %s 로 거부하면 그 사람 문구를 그대로 돌려준다', async (reason, pattern) => {
    admin({})
    mocks.applyWorkflowEvent.mockResolvedValueOnce({ ok: false, conflict: false, reason, orderStatus: null, error: REASON_TEXT[reason as string] })
    const r = await setWbsStage(W1, 'xx')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(pattern)
    expect(mocks.recordProgressSnapshot).not.toHaveBeenCalled()
  })

  it('허용 밖 문자열 거부 — fp 도 0096 에서 어휘에서 빠졌다', async () => {
    const { calls } = admin({})
    for (const bad of ['dd', 'fp']) {
      expect(await setWbsStage(W1, bad as never)).toEqual({ ok: false, error: '허용되지 않는 단계입니다.' })
    }
    expect(calls).toHaveLength(0)
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })

  it('실적이 바뀐 전이면 진척 스냅샷을 남긴다', async () => {
    admin({})
    mocks.applyWorkflowEvent.mockResolvedValueOnce({ ...WF_OK, stage: 'ip', actualPct: 30, stageChanged: true, actualChanged: true })
    expect(await setWbsStage(W1, 'ip')).toEqual({ ok: true })
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1)
  })

  describe('im·xx 첫 도달(reachedFirst) → 후행 unblocked 알림(§2.10, 실제 notifyOnReached 경로)', () => {
    const REACHED = { ...WF_OK, stage: 'im', stageChanged: true, reachedFirst: true }
    const ITEM = { id: W1, project_id: P1, name: 'Task A', external_ref: 'mod/1' }
    beforeEach(() => { mocks.applyWorkflowEvent.mockResolvedValue(REACHED) })

    it('(a) depends 로 이 항목을 참조하는 후행 리프 담당자에게 발행(미배정 후행은 건너뜀)', async () => {
      const W3 = '77777777-7777-4777-8777-777777777777'
      const { captured } = admin({
        wbs_items: [
          { data: ITEM }, // 도달 알림용 항목
          { data: [
            { id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1'] },
            { id: W3, name: 'Task C', assignee_member_id: null, depends: ['mod/1'] }, // 미배정 — 선행 조회도 스킵
          ] },
          { data: [{ external_ref: 'mod/1', stage: 'im' }] }, // W2 의 depends 전체 충족 확인
        ],
      })
      const r = await setWbsStage(W1, 'im')
      expect(r.ok).toBe(true)
      expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
      expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'work.unblocked', projectId: P1, actorUserId: 'admin-1', entityType: 'wbs_item',
        entityId: W2, recipientMemberIds: [M2], dedupeKey: `unblocked:${W2}:${W1}`,
      }))
      expect(captured['wbs_items.contains']).toEqual([['depends', ['mod/1']]])
    })
    it('(e) 후행의 depends 2개 중 하나만 충족 — 전체 미충족이라 무발행', async () => {
      admin({
        wbs_items: [
          { data: ITEM },
          { data: [{ id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1', 'mod/2'] }] },
          { data: [{ external_ref: 'mod/1', stage: 'im' }, { external_ref: 'mod/2', stage: 'ip', actual_pct: 30 }] },
        ],
      })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).not.toHaveBeenCalled()
    })
    it('(f) 마지막 선행이 충족되면 1회 발행 — 실적 100 선행도 충족(스펙 §3.7)', async () => {
      admin({
        wbs_items: [
          { data: ITEM },
          { data: [{ id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1', 'mod/2'] }] },
          { data: [{ external_ref: 'mod/1', stage: 'im' }, { external_ref: 'mod/2', stage: null, actual_pct: 100 }] },
        ],
      })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
      expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'work.unblocked', entityId: W2, dedupeKey: `unblocked:${W2}:${W1}` }))
    })
    it('depends 에 같은 external_ref 가 중복돼도 정상 발행(길이 대신 고유 개수로 비교)', async () => {
      admin({
        wbs_items: [
          { data: ITEM },
          { data: [{ id: W2, name: 'Task B', assignee_member_id: M2, depends: ['mod/1', 'mod/1'] }] },
          // .in() 은 중복 없이 실제 존재하는 행만 1개 반환한다 — 고유 개수(1)와 비교해야 통과한다.
          { data: [{ external_ref: 'mod/1', stage: 'im' }] },
        ],
      })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
    })
    it('후행 목록에 자기 자신(자기 참조 depends)이 있으면 건너뛴다 — 본인에게 알림 가지 않음', async () => {
      admin({
        wbs_items: [
          { data: ITEM },
          { data: [{ id: W1, name: 'Task A', assignee_member_id: M1, depends: ['mod/1'] }] },
        ],
      })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).not.toHaveBeenCalled()
    })
    it('(b) 첫 도달이 아니면(reachedFirst:false — 예: im→xx) 알림 경로를 타지 않는다', async () => {
      mocks.applyWorkflowEvent.mockResolvedValueOnce({ ...WF_OK, stage: 'xx', stageChanged: true, reachedFirst: false })
      const { calls } = admin({})
      expect((await setWbsStage(W1, 'xx')).ok).toBe(true)
      expect(calls).toHaveLength(0)
      expect(mocks.emitNotification).not.toHaveBeenCalled()
    })
    it('(c) 후행 리프가 없으면 무발행', async () => {
      admin({ wbs_items: [{ data: ITEM }, { data: [] }] })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).not.toHaveBeenCalled()
    })
    it('(d) 후행 조회 실패 시 발행 생략 + setWbsStage 는 ok:true 유지', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      admin({ wbs_items: [{ data: ITEM }, { data: null, error: { message: 'boom' } }] })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).not.toHaveBeenCalled()
      errSpy.mockRestore()
    })
    it('external_ref 가 없으면 후행 조회 자체를 하지 않는다', async () => {
      const { calls } = admin({ wbs_items: [{ data: { ...ITEM, external_ref: null } }] })
      expect((await setWbsStage(W1, 'im')).ok).toBe(true)
      expect(mocks.emitNotification).not.toHaveBeenCalled()
      expect(calls.filter(t => t === 'wbs_items')).toHaveLength(1) // 도달 알림용 항목 조회뿐
    })
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
            maybeSingle: async () => ({
              data: { assignee_member_id: M1, stage: 'ip', dev_workflow: true }, error: null,
            }),
          }),
        }),
      }),
    })
    const r = await getWbsAssigneeStage(W1)
    expect(mocks.resolveProjectId).toHaveBeenCalledWith('wbs_items', W1)
    expect(mocks.requireProjectMember).toHaveBeenCalledWith(P1)
    expect(r).toEqual({ assigneeMemberId: M1, stage: 'ip', devWorkflow: true, delegated: false })
  })

  it('위임 태그가 있으면 delegated:true — 단계 드롭다운 잠금 표시 재료를 같은 select 로 읽는다', async () => {
    const selected: string[] = []
    mocks.createServerClient.mockResolvedValue({
      from: () => ({
        select: (cols: string) => {
          selected.push(cols)
          return { eq: () => ({ maybeSingle: async () => ({ data: { assignee_member_id: null, stage: 'ip', dev_workflow: true, tags: ['agent', 'x'] }, error: null }) }) }
        },
      }),
    })
    expect(await getWbsAssigneeStage(W1)).toEqual({ assigneeMemberId: null, stage: 'ip', devWorkflow: true, delegated: true })
    expect(selected).toEqual(['assignee_member_id, stage, dev_workflow, tags'])
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
