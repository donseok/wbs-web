// tests/actions/agent-console-actions.test.ts — 콘솔 보내기·보기 서버 액션의 게이트(계약 §2.12 권한 표).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), createAdminClient: vi.fn(), fetchConsoleSeatOwners: vi.fn(), fetchConsoleSeats: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: mocks.getActor, requireProjectMember: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/agentSeatmap', () => ({ fetchConsoleSeatOwners: mocks.fetchConsoleSeatOwners, fetchConsoleSeats: mocks.fetchConsoleSeats, viewerEmail: vi.fn() }))
vi.mock('@/lib/data/agentHub', () => ({ getAgentHub: vi.fn() }))
vi.mock('@/app/actions/agentWork', () => ({}))
vi.mock('@/app/actions/wbsAssign', () => ({}))
vi.mock('@/app/actions/designActions', () => ({}))
import { getConsoleView, sendConsolePrompt } from '@/app/actions/agentHub'

const P1 = '11111111-1111-4111-8111-111111111111'
const actor = (userId: string, roles: Array<[string, string]> = [], isSuperuser = false) =>
  ({ userId, isSuperuser, projectRoles: new Map(roles), rosterTeams: new Map(), teamCode: null, teamId: null })
const ME = actor('u-me')
const ADMIN = actor('u-admin', [[P1, 'admin']])
const SUPER = actor('u-super', [], true)
const LANE = 'me/mbp/임시:kit·노드 엔진'
const NOW = Date.now()

type Resp = { data?: unknown; error?: { message: string } | null }
interface Calls { rpc: Array<[string, Record<string, unknown>]>; ops: Array<[string, string, unknown[]]> }
function mockAdmin(tables: Record<string, Resp[]> = {}, rpc: Record<string, Resp[]> = {}): Calls {
  const calls: Calls = { rpc: [], ops: [] }
  mocks.createAdminClient.mockReturnValue({
    from: (table: string) => {
      const resp = (tables[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = (...a: unknown[]) => { calls.ops.push([table, k, a]); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push([fn, args])
      const resp = (rpc[fn] ?? []).shift() ?? { data: [], error: null }
      return { data: resp.data ?? null, error: resp.error ?? null }
    },
  })
  return calls
}

beforeEach(() => vi.resetAllMocks())

describe('sendConsolePrompt — 세션 주인 본인만', () => {
  it('본인이면 정리된 본문으로 넣고, host·대상은 좌석 키에서 읽는다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
    const calls = mockAdmin({}, { agent_console_enqueue: [{ data: [{ outcome: 'ok', id: 'new-1' }] }] })
    expect(await sendConsolePrompt(LANE, ' 상태\n알려줘 ')).toEqual({ ok: true, id: 'new-1' })
    expect(calls.rpc[0]).toEqual(['agent_console_enqueue', { p_owner: 'u-me', p_host: 'mbp', p_kind: 'coord_lane', p_ref: 'kit', p_text: '상태 알려줘' }])
  })
  it('프로젝트 관리자·슈퍼유저도 남의 세션에는 못 보낸다(not_owner)', async () => {
    for (const who of [ADMIN, SUPER]) {
      mocks.getActor.mockResolvedValue(who)
      mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
      const calls = mockAdmin()
      const r = await sendConsolePrompt('me/mbp/lead', '상태')
      expect(r).toMatchObject({ ok: false, code: 'not_owner' })
      expect(calls.rpc).toHaveLength(0)
    }
  })
  it('살아 있는 좌석이 없으면 target_unknown, 좌석 조회 실패는 error(위장 금지)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([])
    mockAdmin()
    expect(await sendConsolePrompt(LANE, '상태')).toMatchObject({ ok: false, code: 'target_unknown' })
    mocks.fetchConsoleSeatOwners.mockRejectedValue(new Error('boom'))
    expect(await sendConsolePrompt(LANE, '상태')).toMatchObject({ ok: false, code: 'error' })
  })
  it('입력 정리 — 빈 글·느낌표·2001자는 넣기 전에 거절', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
    const calls = mockAdmin()
    expect(await sendConsolePrompt(LANE, '\n\t ')).toMatchObject({ code: 'empty' })
    expect(await sendConsolePrompt(LANE, '다시 해!')).toMatchObject({ code: 'bang_in_text' })
    expect(await sendConsolePrompt(LANE, 'a'.repeat(2001))).toMatchObject({ code: 'too_long' })
    expect(calls.rpc).toHaveLength(0)
  })
  it('대상이 아닌 키·비로그인은 거절', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mockAdmin()
    expect(await sendConsolePrompt('me/mbp/poll', '상태')).toMatchObject({ code: 'bad_target' })
    expect(await sendConsolePrompt('me/mbp/coord', '상태')).toMatchObject({ code: 'bad_target' })
    mocks.getActor.mockResolvedValue(null)
    expect(await sendConsolePrompt(LANE, '상태')).toMatchObject({ code: 'unauthorized' })
    mocks.getActor.mockRejectedValue(new Error('auth down'))
    expect(await sendConsolePrompt(LANE, '상태')).toMatchObject({ code: 'unauthorized' })
  })
  it('DB 한도 — rate_limited·queue_full 을 그대로 알린다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
    mockAdmin({}, { agent_console_enqueue: [{ data: [{ outcome: 'rate_limited', id: null }] }] })
    expect(await sendConsolePrompt(LANE, '상태')).toMatchObject({ code: 'rate_limited' })
    mockAdmin({}, { agent_console_enqueue: [{ data: [{ outcome: 'queue_full', id: null }] }] })
    expect(await sendConsolePrompt(LANE, '상태')).toMatchObject({ code: 'queue_full' })
  })
})

describe('getConsoleView — 화면은 본인 + 그 좌석 프로젝트 관리자, 전달 상태는 본인만', () => {
  const screenRow = { lines: ['$ ls'], captured_at: new Date(NOW - 30_000).toISOString(), updated_at: new Date(NOW - 30_000).toISOString() }
  it('본인 — 보내기·전달 상태·화면을 다 본다(정리 먼저)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
    const calls = mockAdmin({
      agent_console_prompts: [{ data: [{ id: 'p1', text: '상태', status: 'sent', reason: null, created_at: 'x' }] }],
      agent_console_screens: [{ data: screenRow }],
    })
    const v = await getConsoleView(LANE)
    expect(v).toMatchObject({ ok: true, canSend: true, canView: true, sendBlockedReason: null,
      prompts: [{ id: 'p1', text: '상태', status: 'sent', reason: null, createdAt: 'x' }], screen: { lines: ['$ ls'] } })
    expect(calls.rpc[0]).toEqual(['agent_console_sweep', { p_owner: 'u-me' }])
    expect(calls.ops).toContainEqual(['agent_console_prompts', 'eq', ['owner', 'u-me']])
    expect(calls.ops).toContainEqual(['agent_console_screens', 'eq', ['owner', 'u-me']])
  })
  const W1 = (projectId: string | null) => ({ kind: 'team_worker', ref: 'w1', host: 'mbp', projectId })
  it('그 좌석 프로젝트의 관리자 — 화면만 본다(주인의 화면), 보내기·전달 상태는 없다', async () => {
    mocks.getActor.mockResolvedValue(ADMIN)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
    mocks.fetchConsoleSeats.mockResolvedValue([W1(P1), { kind: 'team_lead', ref: 'lead', host: 'mbp', projectId: null }])
    const calls = mockAdmin({ agent_console_screens: [{ data: screenRow }] })
    const v = await getConsoleView('me/mbp/w1')
    expect(v).toMatchObject({ ok: true, canSend: false, canView: true, screen: { lines: ['$ ls'] } })
    expect(v.ok && 'prompts' in v).toBe(false)
    expect(calls.ops).toContainEqual(['agent_console_screens', 'eq', ['owner', 'u-me']])
    expect(calls.ops.some(o => o[0] === 'agent_console_prompts')).toBe(false)
    expect(calls.rpc).toHaveLength(0)
  })
  it('프로젝트를 정할 수 없는 좌석(project_id null)은 관리자·슈퍼유저도 못 본다(fail-closed)', async () => {
    for (const who of [ADMIN, SUPER]) {
      mocks.getActor.mockResolvedValue(who)
      mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
      mocks.fetchConsoleSeats.mockResolvedValue([{ kind: 'coord_lane', ref: 'kit', host: 'mbp', projectId: null }])
      const calls = mockAdmin()
      expect(await getConsoleView(LANE)).toMatchObject({ ok: true, canSend: false, canView: false })
      expect(calls.ops).toHaveLength(0)
    }
  })
  it('다른 프로젝트의 관리자는 못 본다, 슈퍼유저는 프로젝트가 있으면 본다', async () => {
    mocks.getActor.mockResolvedValue(actor('u-x', [['other', 'admin']]))
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
    mocks.fetchConsoleSeats.mockResolvedValue([W1(P1)])
    mockAdmin()
    expect(await getConsoleView('me/mbp/w1')).toMatchObject({ canView: false })
    mocks.getActor.mockResolvedValue(SUPER)
    mockAdmin({ agent_console_screens: [{ data: screenRow }] })
    expect(await getConsoleView('me/mbp/w1')).toMatchObject({ canView: true, canSend: false })
  })
  it('같은 화면 행을 쓰는 주인의 다른 좌석이 남의 프로젝트·프로젝트 없음이면 관리자도 못 본다(화면 행 겹침)', async () => {
    mocks.getActor.mockResolvedValue(ADMIN)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
    for (const other of [W1('other-project'), W1(null)]) {
      mocks.fetchConsoleSeats.mockResolvedValue([W1(P1), other])
      const calls = mockAdmin()
      expect(await getConsoleView('me/mbp/w1')).toMatchObject({ canView: false })
      expect(calls.ops).toHaveLength(0)
    }
  })
  it('같은 좌석 키의 주인이 둘 이상이면 관리자는 못 본다(어느 계정의 화면인지 가를 수 없다), 본인은 자기 화면을 본다', async () => {
    mocks.getActor.mockResolvedValue(ADMIN)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }, { owner: 'u-other', projectId: P1 }])
    mocks.fetchConsoleSeats.mockResolvedValue([W1(P1)])
    mockAdmin()
    expect(await getConsoleView('me/mbp/w1')).toMatchObject({ canView: false })
    expect(mocks.fetchConsoleSeats).not.toHaveBeenCalled()
    mocks.getActor.mockResolvedValue(ME)
    const calls = mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }] })
    expect(await getConsoleView('me/mbp/w1')).toMatchObject({ canSend: true, canView: true })
    expect(calls.ops).toContainEqual(['agent_console_screens', 'eq', ['owner', 'u-me']])
  })
  it('관리자 판정용 좌석 조회가 실패하면 실패로 답한다(위장 금지)', async () => {
    mocks.getActor.mockResolvedValue(ADMIN)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
    mocks.fetchConsoleSeats.mockRejectedValue(new Error('boom'))
    mockAdmin()
    expect(await getConsoleView('me/mbp/w1')).toEqual({ ok: false, error: '세션 확인에 실패했습니다.' })
  })
  it('24시간 넘은 화면은 없음, 조회 실패는 실패 문구(위장 금지)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
    mockAdmin({ agent_console_prompts: [{ error: { message: 'x' } }], agent_console_screens: [{ data: { ...screenRow, updated_at: new Date(NOW - 25 * 3600_000).toISOString() } }] })
    const v = await getConsoleView(LANE)
    expect(v).toMatchObject({ ok: true, prompts: null, promptsError: '전달 상태 조회에 실패했습니다.', screen: null })
    mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ error: { message: 'x' } }] })
    expect(await getConsoleView(LANE)).toMatchObject({ screenError: '화면 조회에 실패했습니다.' })
  })
  it('좌석이 살아 있지 않으면 보내기 사유를 알린다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([])
    mockAdmin()
    expect(await getConsoleView(LANE)).toMatchObject({ ok: true, canSend: false, canView: false, sendBlockedReason: expect.stringContaining('오피스에 없습니다') })
  })
})
