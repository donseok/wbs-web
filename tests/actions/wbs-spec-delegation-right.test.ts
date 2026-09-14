// tests/actions/wbs-spec-delegation-right.test.ts — 위임·프롬프트 자격(관리자 또는 담당자 본인)과 멤버 경로의 본체
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(), createServerClient: vi.fn(),
  myMemberIds: vi.fn(), viewerEmail: vi.fn(),
  ensureAgentProject: vi.fn(), backfillProjectOrders: vi.fn(), ensureOrderForWorkflowLeaf: vi.fn(),
  transitionStage: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin, requireProjectMember: mocks.requireProjectMember, resolveProjectId: mocks.resolveProjectId }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail, DONE_WINDOW_MS: 0 }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureAgentProject: mocks.ensureAgentProject, backfillProjectOrders: mocks.backfillProjectOrders, ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf }))
vi.mock('@/lib/agent/stageTransition', () => ({ transitionStage: mocks.transitionStage }))

import { ERR_AGENT_OFF, ERR_NOT_ASSIGNEE, requireDelegationRight } from '@/lib/agent/delegation'
import { setAgentDelegation, updateAgentPrompt } from '@/app/actions/wbsSpec'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null }

/** 큐 기반 admin 목 — 테이블별 순차 응답 + update/insert payload 캡처 + 호출된 테이블 목록. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const calls: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'neq', 'order', 'limit']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { captured, calls }
}

const MEMBER = { ok: true, actor: { userId: 'member-1' } }
const DENIED = { ok: false, error: '권한이 없습니다.' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.requireProjectAdmin.mockResolvedValue(DENIED)
  mocks.requireProjectMember.mockResolvedValue(MEMBER)
  mocks.viewerEmail.mockResolvedValue('yoo@example.com')
  mocks.myMemberIds.mockResolvedValue(['m1'])
  mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: true, activated: false, stopped: false })
  mocks.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: true })
  mocks.transitionStage.mockResolvedValue({ ok: true })
})

describe('requireDelegationRight', () => {
  it('관리자면 멤버 판정·담당자 조회 없이 통과', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { calls } = admin({})
    const r = await requireDelegationRight(W1)
    expect(r).toEqual({ ok: true, actor: { userId: 'admin-1' }, projectId: P1, isAdmin: true })
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
  it('멤버 + 담당자 본인(로스터 id 일치) → 통과, isAdmin=false', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }] })
    const r = await requireDelegationRight(W1)
    expect(r).toEqual({ ok: true, actor: { userId: 'member-1' }, projectId: P1, isAdmin: false })
    expect(mocks.myMemberIds).toHaveBeenCalledWith(expect.anything(), { userId: 'member-1', userEmail: 'yoo@example.com', projectId: P1 })
  })
  it('멤버 + 담당자가 남 → 거부(ERR_NOT_ASSIGNEE)', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm9' } }] })
    expect(await requireDelegationRight(W1)).toEqual({ ok: false, error: ERR_NOT_ASSIGNEE })
  })
  it('멤버 + 담당자 미배정 → 거부', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: null } }] })
    expect(await requireDelegationRight(W1)).toEqual({ ok: false, error: ERR_NOT_ASSIGNEE })
  })
  it('멤버도 아니면 멤버 가드 오류 그대로', async () => {
    mocks.requireProjectMember.mockResolvedValue(DENIED)
    expect(await requireDelegationRight(W1)).toEqual(DENIED)
  })
  it('resolveProjectId 실패면 담당자 조회 전에 중단', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const { calls } = admin({})
    expect(await requireDelegationRight(W1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(calls).toEqual([])
  })
  it('뷰어 이메일 조회가 throw 하면 거부(fail-closed)', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }] })
    mocks.viewerEmail.mockRejectedValue(new Error('auth down'))
    const r = await requireDelegationRight(W1)
    expect(r.ok).toBe(false)
  })
  it('잘못된 itemId → 거부', async () => {
    expect(await requireDelegationRight('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

describe('setAgentDelegation — 멤버 경로', () => {
  it('담당자 본인 + 프로젝트 등록·활성 → 태그 붙이고 주문 보장, ensureAgentProject 호출', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }],
      agent_projects: [{ data: { enabled: true } }],
    })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect((captured.wbs_items?.[0] as { tags: string[] }).tags).toEqual(['agent'])
    expect(mocks.ensureAgentProject).toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalled()
  })
  it('담당자 본인 + 프로젝트 미등록 → ERR_AGENT_OFF, 태그 쓰기 0, ensureAgentProject 미호출', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: null }] })
    expect(await setAgentDelegation(W1, true)).toEqual({ ok: false, error: ERR_AGENT_OFF })
    expect(captured.wbs_items).toBeUndefined()
    expect(mocks.ensureAgentProject).not.toHaveBeenCalled()
  })
  it('담당자 본인 + 프로젝트 중지(enabled=false) → ERR_AGENT_OFF', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: { enabled: false } }] })
    expect(await setAgentDelegation(W1, true)).toEqual({ ok: false, error: ERR_AGENT_OFF })
  })
  it('담당자 본인 해제(false)는 프로젝트 상태와 무관하게 진행 — ready 주문 취소', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: ['agent'], dev_workflow: true } }, { data: [{ id: W1 }] }],
      agent_work_orders: [{ data: [{ id: 'o1', status: 'ready' }] }, { data: null }],
    })
    const r = await setAgentDelegation(W1, false)
    expect(r.ok).toBe(true)
    expect((captured.agent_work_orders?.[0] as { status: string }).status).toBe('cancelled')
  })
  it('관리자 경로는 agent_projects 사전 확인 없이 ensureAgentProject 로 간다(종전 동작)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { calls } = admin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect(mocks.ensureAgentProject).toHaveBeenCalled()
    expect(calls.filter(t => t === 'agent_projects')).toEqual([])
  })
  it('dev_workflow 가 꺼져 있던 리프는 켜면서 이력 1건 + 담당자 있고 단계 없으면 as 전이', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { captured } = admin({
      wbs_items: [
        { data: { tags: [], dev_workflow: false } },                                      // 본체 첫 조회
        { data: [{ id: W1 }] },                                                            // 태그 update
        { data: [{ id: W1, assignee_member_id: 'm1', stage: null }] },                     // dev_workflow update
      ],
    })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect((captured.wbs_items?.[1] as { dev_workflow: boolean }).dev_workflow).toBe(true)
    expect((captured.change_logs?.[0] as { field: string; new_value: string })).toMatchObject({ field: 'dev_workflow', new_value: 'true', wbs_item_id: W1 })
    expect(mocks.transitionStage).toHaveBeenCalledWith(expect.anything(), { itemId: W1, to: 'as', fromIn: [null], actorUserId: 'admin-1' })
  })
  it('프로젝트가 중지 상태면 태그는 붙고 주문은 안 나가며 warning 에 에이전트 페이지 안내', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: false, activated: false, stopped: true })
    admin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('에이전트 페이지에서 켜면')
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })
})

describe('updateAgentPrompt — 담당자 본인', () => {
  it('멤버 담당자 본인이면 저장', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: [{ id: W1 }] }] })
    expect(await updateAgentPrompt(W1, ' 지시 ')).toEqual({ ok: true })
    expect((captured.wbs_items?.[0] as { agent_prompt: string }).agent_prompt).toBe('지시')
  })
  it('멤버 비담당자면 거부, 쓰기 0', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm9' } }] })
    expect(await updateAgentPrompt(W1, 'x')).toEqual({ ok: false, error: ERR_NOT_ASSIGNEE })
    expect(captured.wbs_items).toBeUndefined()
  })
})
