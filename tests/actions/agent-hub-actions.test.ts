// tests/actions/agent-hub-actions.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), createAdminClient: vi.fn(),
  getAgentHub: vi.fn(), applyDelegation: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin, requireProjectMember: mocks.requireProjectMember }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/agentHub', () => ({ getAgentHub: mocks.getAgentHub }))
vi.mock('@/lib/agent/delegation', () => ({ applyDelegation: mocks.applyDelegation }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
import { refreshAgentHub, setAgentDelegationBulk } from '@/app/actions/agentHub'

const P1 = '11111111-1111-4111-8111-111111111111'
const I = (n: number) => `33333333-3333-4333-8333-33333333333${n}`
const ADMIN = { ok: true, actor: { userId: 'admin-1', isSuperuser: false, projectRoles: new Map([[P1, 'admin']]), rosterTeams: new Map(), teamCode: null, teamId: null } }
const MEMBER = { ok: true, actor: { ...ADMIN.actor, userId: 'member-1', projectRoles: new Map([[P1, 'member']]) } }
const DENIED = { ok: false, error: '권한이 없습니다.' }

function adminClient(itemsInProject: string[]) {
  const client = { from: vi.fn(() => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in']) b[k] = () => b
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: itemsInProject.map(id => ({ id })), error: null }).then(r)
    return b
  }) }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}

beforeEach(() => { vi.clearAllMocks(); mocks.requireProjectAdmin.mockResolvedValue(ADMIN); mocks.requireProjectMember.mockResolvedValue(MEMBER) })

describe('refreshAgentHub', () => {
  it('멤버 → getAgentHub(projectId, {userId, isAdmin}) 결과', async () => {
    mocks.getAgentHub.mockResolvedValue({ projectId: P1 })
    const r = await refreshAgentHub(P1)
    expect(r).toEqual({ ok: true, hub: { projectId: P1 } })
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'member-1', isAdmin: false })
  })
  it('관리자면 isAdmin=true 로 넘긴다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    mocks.getAgentHub.mockResolvedValue({})
    await refreshAgentHub(P1)
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'admin-1', isAdmin: true })
  })
  it('가드 거부 → 오류 그대로, 조회 없음', async () => {
    mocks.requireProjectMember.mockResolvedValue(DENIED)
    expect(await refreshAgentHub(P1)).toEqual(DENIED)
    expect(mocks.getAgentHub).not.toHaveBeenCalled()
  })
  it('조회 throw → 고정 문구', async () => {
    mocks.getAgentHub.mockRejectedValue(new Error('db'))
    expect(await refreshAgentHub(P1)).toEqual({ ok: false, error: '에이전트 현황 재조회에 실패했습니다.' })
  })
  it('잘못된 projectId → 거부', async () => {
    expect(await refreshAgentHub('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

describe('setAgentDelegationBulk', () => {
  it('관리자 → 항목마다 applyDelegation(isAdmin=true), 부분 실패 집계, revalidatePath 1회', async () => {
    adminClient([I(1), I(2), I(3)])
    mocks.applyDelegation
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: '리프 아님' })
      .mockResolvedValueOnce({ ok: true, warning: '중지 상태' })
    const r = await setAgentDelegationBulk(P1, [I(1), I(2), I(3)], true)
    expect(r).toEqual({ ok: true, applied: 2, failed: [{ itemId: I(2), error: '리프 아님' }], warning: '중지 상태' })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(3)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), projectId: P1, delegated: true, actorUserId: 'admin-1', isAdmin: true })
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1)
  })
  it('비관리자 → 거부, 적용 0', async () => {
    mocks.requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await setAgentDelegationBulk(P1, [I(1)], true)).toEqual(DENIED)
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('타 프로젝트 항목이 섞이면 전부 거부', async () => {
    adminClient([I(1)])
    expect(await setAgentDelegationBulk(P1, [I(1), I(2)], true)).toEqual({ ok: false, error: '이 프로젝트의 항목이 아닌 것이 있습니다.' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('빈 목록·200 초과·비 uuid → 거부', async () => {
    expect(await setAgentDelegationBulk(P1, [], true)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(await setAgentDelegationBulk(P1, Array.from({ length: 201 }, (_, i) => I(i % 10)), true)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(await setAgentDelegationBulk(P1, ['x'], true)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})
