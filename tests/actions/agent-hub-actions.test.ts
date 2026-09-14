// tests/actions/agent-hub-actions.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), createAdminClient: vi.fn(),
  getAgentHub: vi.fn(), applyDelegation: vi.fn(), viewerEmail: vi.fn(), myMemberIds: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectMember: mocks.requireProjectMember }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/agentHub', () => ({ getAgentHub: mocks.getAgentHub }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: mocks.viewerEmail }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds }))
vi.mock('@/lib/agent/delegation', () => ({
  applyDelegation: mocks.applyDelegation, ERR_NOT_ASSIGNEE: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.',
}))
import { refreshAgentHub, applyHubDelegations } from '@/app/actions/agentHub'

const P1 = '11111111-1111-4111-8111-111111111111'
const I = (n: number) => `33333333-3333-4333-8333-33333333333${n}`
const ADMIN = { ok: true, actor: { userId: 'admin-1', isSuperuser: false, projectRoles: new Map([[P1, 'admin']]), rosterTeams: new Map(), teamCode: null, teamId: null } }
const MEMBER = { ok: true, actor: { ...ADMIN.actor, userId: 'member-1', projectRoles: new Map([[P1, 'member']]) } }
const DENIED = { ok: false, error: '권한이 없습니다.' }
const HUB = { projectId: P1, rows: [] }

/** wbs_items 조회(id, assignee_member_id) 흉내 — select/eq/in 체인 뒤 thenable. */
function adminClient(items: { id: string; assignee_member_id?: string | null }[], error: { message: string } | null = null) {
  const client = { from: vi.fn(() => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in']) b[k] = () => b
    b.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : items.map(i => ({ id: i.id, assignee_member_id: i.assignee_member_id ?? null })), error }).then(r)
    return b
  }) }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue(MEMBER)
  mocks.getAgentHub.mockResolvedValue(HUB)
  mocks.applyDelegation.mockResolvedValue({ ok: true })
})

describe('refreshAgentHub', () => {
  it('멤버 → getAgentHub(projectId, {userId, isAdmin}) 결과', async () => {
    const r = await refreshAgentHub(P1)
    expect(r).toEqual({ ok: true, hub: HUB })
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'member-1', isAdmin: false })
  })
  it('관리자면 isAdmin=true 로 넘긴다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
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

describe('applyHubDelegations — 묶음 1건: 가드 1회 → 항목별 applyDelegation → 허브 재조회를 한 응답에', () => {
  it('관리자: 보낸 순서대로 applyDelegation(isAdmin=true), 실패·경고는 항목별로 모으고 허브를 돌려준다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }, { id: I(2) }, { id: I(3) }])
    mocks.applyDelegation
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: '리프 아님' })
      .mockResolvedValueOnce({ ok: true, warning: '중지 상태' })
    const r = await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(2), delegated: true }, { itemId: I(3), delegated: false }])
    expect(r).toEqual({ ok: true, hub: HUB, failed: [{ itemId: I(2), error: '리프 아님' }], warnings: [{ itemId: I(3), warning: '중지 상태' }] })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(3)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), projectId: P1, delegated: true, actorUserId: 'admin-1', isAdmin: true })
    expect(mocks.applyDelegation.mock.calls[2][1]).toMatchObject({ itemId: I(3), delegated: false })
    expect(mocks.getAgentHub).toHaveBeenCalledWith(P1, { userId: 'admin-1', isAdmin: true })
    // 관리자는 로스터 판정을 하지 않는다.
    expect(mocks.viewerEmail).not.toHaveBeenCalled(); expect(mocks.myMemberIds).not.toHaveBeenCalled()
  })
  it('멤버: 로스터 판정은 묶음당 1회, 담당자 본인 항목만 적용하고 남의 항목은 그 항목만 failed', async () => {
    adminClient([{ id: I(1), assignee_member_id: 'm1' }, { id: I(2), assignee_member_id: 'm2' }, { id: I(3), assignee_member_id: null }])
    mocks.viewerEmail.mockResolvedValue('me@x.com')
    mocks.myMemberIds.mockResolvedValue(['m1'])
    const r = await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(2), delegated: true }, { itemId: I(3), delegated: true }])
    expect(r).toEqual({
      ok: true, hub: HUB, warnings: [],
      failed: [
        { itemId: I(2), error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' },
        { itemId: I(3), error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' },
      ],
    })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(1)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), actorUserId: 'member-1', isAdmin: false })
    expect(mocks.viewerEmail).toHaveBeenCalledTimes(1)
    expect(mocks.myMemberIds).toHaveBeenCalledTimes(1)
    expect(mocks.myMemberIds).toHaveBeenCalledWith(expect.anything(), { userId: 'member-1', userEmail: 'me@x.com', projectId: P1 })
  })
  it('멤버 로스터 판정 실패 → 묶음 전체 거부(fail-closed), 적용 0', async () => {
    adminClient([{ id: I(1), assignee_member_id: 'm1' }])
    mocks.viewerEmail.mockRejectedValue(new Error('auth down'))
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])).toEqual({ ok: false, error: '담당자 판정에 실패했습니다.' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('타 프로젝트 항목이 섞이면 전부 거부', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }])
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(2), delegated: true }]))
      .toEqual({ ok: false, error: '이 프로젝트의 항목이 아닌 것이 있습니다.' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('항목 조회 실패 → 거부, 적용 0', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([], { message: 'boom' })
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])).toEqual({ ok: false, error: '항목 조회 실패: boom' })
    expect(mocks.applyDelegation).not.toHaveBeenCalled()
  })
  it('같은 항목이 여러 번 오면 마지막 값만 1회 적용', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }])
    await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }, { itemId: I(1), delegated: false }])
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(1)
    expect(mocks.applyDelegation.mock.calls[0][1]).toMatchObject({ itemId: I(1), delegated: false })
  })
  it('저장 뒤 재조회만 실패 → ok:true + hub:null + hubError (변경은 이미 저장됐다는 사실을 숨기지 않는다)', async () => {
    mocks.requireProjectMember.mockResolvedValue(ADMIN)
    adminClient([{ id: I(1) }])
    mocks.getAgentHub.mockRejectedValue(new Error('db'))
    const r = await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])
    expect(r).toEqual({ ok: true, hub: null, hubError: '변경은 저장됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.', failed: [], warnings: [] })
    expect(mocks.applyDelegation).toHaveBeenCalledTimes(1)
  })
  it('가드 거부 → 오류 그대로, 조회·적용 없음', async () => {
    mocks.requireProjectMember.mockResolvedValue(DENIED)
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: true }])).toEqual(DENIED)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('빈 목록·200 초과·비 uuid·비 boolean → 거부', async () => {
    const BAD = { ok: false, error: '잘못된 요청입니다.' }
    expect(await applyHubDelegations(P1, [])).toEqual(BAD)
    expect(await applyHubDelegations(P1, Array.from({ length: 201 }, (_, i) => ({ itemId: I(i % 10), delegated: true })))).toEqual(BAD)
    expect(await applyHubDelegations(P1, [{ itemId: 'x', delegated: true }])).toEqual(BAD)
    expect(await applyHubDelegations(P1, [{ itemId: I(1), delegated: 'yes' as unknown as boolean }])).toEqual(BAD)
    expect(await applyHubDelegations('nope', [{ itemId: I(1), delegated: true }])).toEqual(BAD)
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })
  it('허브 액션은 revalidatePath 를 부르지 않는다 — 응답의 hub 로 갱신하며 페이지 재렌더를 싣지 않는다(소스 문자열 검사)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/actions/agentHub.ts'), 'utf8')
    expect(src).not.toMatch(/revalidatePath\(/)
  })
})
