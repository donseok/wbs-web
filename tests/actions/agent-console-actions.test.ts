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
import { getConsoleView, sendConsoleKeys, sendConsolePrompt } from '@/app/actions/agentHub'

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

// ── 키 입력(계약 lane-summary-contract (C)) ─────────────────────────────────────────────────────────────────
const SHA = 'ab'.repeat(32)
const SINCE = '2026-10-06T01:00:00.000Z'
const storedReq = (over: Record<string, unknown> = {}) => ({ v: 1, kind: 'permission', since: SINCE, excerpt: ['Allow Bash?', '1. Yes', '2. No'], handled: null, sha: SHA, ...over })
const watcherRow = (over: Record<string, unknown> = {}, seenAgoMs = 30_000) =>
  ({ data: { input_request: storedReq(over), last_seen_at: new Date(Date.now() - seenAgoMs).toISOString() } })
const REQ = { kind: 'permission', since: SINCE, sha: SHA }
const ownerSeat = () => mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
/** mockAdmin 이 큐를 소비하므로 호출마다 새로 만든다. */
const enqOk = () => ({ agent_console_enqueue_keys: [{ data: [{ outcome: 'ok', id: 'k-1' }] }] })

describe('sendConsoleKeys — 서버가 모든 검사를 다시 한다', () => {
  it('본인·살아 있는 감시자·미처리 입력 요청·대조 일치 → 저장된 값으로 큐에 넣는다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const calls = mockAdmin({ agent_watchers: [watcherRow()] }, enqOk())
    expect(await sendConsoleKeys(LANE, REQ, ['Down', 'Enter'])).toEqual({ ok: true, id: 'k-1' })
    expect(calls.rpc).toEqual([['agent_console_enqueue_keys', {
      p_owner: 'u-me', p_host: 'mbp', p_kind: 'coord_lane', p_ref: 'kit', p_keys: ['Down', 'Enter'],
      p_req_kind: 'permission', p_req_since: SINCE, p_req_sha: SHA,
    }]])
    // 입력 요청은 본인(user_id=actor)의 이 좌석 키 행에서 읽는다
    expect(calls.ops).toContainEqual(['agent_watchers', 'eq', ['user_id', 'u-me']])
    expect(calls.ops).toContainEqual(['agent_watchers', 'eq', ['agent', LANE]])
  })
  it('세 종류(permission·question·choice)에 답할 수 있다', async () => {
    for (const kind of ['permission', 'question', 'choice']) {
      mocks.getActor.mockResolvedValue(ME)
      ownerSeat()
      mockAdmin({ agent_watchers: [watcherRow({ kind })] }, enqOk())
      expect(await sendConsoleKeys(LANE, { ...REQ, kind }, ['2'])).toMatchObject({ ok: true })
    }
  })
  it('큐에는 클라이언트가 보낸 값이 아니라 저장된 값이 들어간다(대조가 통과해야만 도달)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    // since 표기만 다른 같은 시각은 문자열이 다르므로 거절 — 문자열이 정확히 같아야 한다.
    const calls = mockAdmin({ agent_watchers: [watcherRow({ since: '2026-10-06T10:00:00+09:00' })] }, enqOk())
    expect(await sendConsoleKeys(LANE, { ...REQ, since: SINCE }, ['1'])).toMatchObject({ ok: false, code: 'prompt_changed' })
    expect(calls.rpc).toHaveLength(0)
    const c2 = mockAdmin({ agent_watchers: [watcherRow({ since: '2026-10-06T10:00:00+09:00' })] }, enqOk())
    expect(await sendConsoleKeys(LANE, { ...REQ, since: '2026-10-06T10:00:00+09:00' }, ['1'])).toMatchObject({ ok: true })
    expect(c2.rpc[0][1]).toMatchObject({ p_req_since: SINCE }) // DB 에는 정규화한 ISO 로 넘긴다
  })
  it('프로젝트 관리자·슈퍼유저도 남의 세션에는 못 보낸다(not_owner) — 입력 요청도 읽지 않는다', async () => {
    for (const who of [ADMIN, SUPER]) {
      mocks.getActor.mockResolvedValue(who)
      mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
      const calls = mockAdmin({ agent_watchers: [watcherRow()] }, enqOk())
      expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: 'not_owner' })
      expect(calls.rpc).toHaveLength(0)
      expect(calls.ops.some(o => o[0] === 'agent_watchers')).toBe(false)
    }
  })
  it('좌석이 없으면 target_unknown, 좌석 조회 실패는 error(fail-closed)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([])
    mockAdmin()
    expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: 'target_unknown' })
    mocks.fetchConsoleSeatOwners.mockRejectedValue(new Error('boom'))
    const calls = mockAdmin()
    expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: 'error' })
    expect(calls.rpc).toHaveLength(0)
  })
  it('키 목록 밖·5개 초과·빈 배열·배열 아님은 bad_keys — DB 를 읽기 전에 거절', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    for (const keys of [['0'], ['enter'], ['Enter '], ['F5'], ['1', '2', '3', '4', '5'], [], ['1', 'Enter'], ['Enter', 'Enter'], ['Esc', 'Esc'], ['1', '2'], ['Enter', 'Up'], ['Up', 'Enter', 'Tab'], ['Tab', 'Enter'], ['Tab', '1'], ['Tab', 'Tab'], 'Enter', null, [1], [['1']], [{}]]) {
      const calls = mockAdmin({ agent_watchers: [watcherRow()] }, enqOk())
      expect(await sendConsoleKeys(LANE, REQ, keys as never), JSON.stringify(keys)).toMatchObject({ ok: false, code: 'bad_keys' })
      expect(calls.rpc).toHaveLength(0)
      expect(calls.ops).toHaveLength(0)
    }
  })
  it('이동 키만 있는 배열과 이동 키 뒤 확정 하나는 넘긴다 — 오류 문구는 확정 키가 마지막 하나뿐임을 알린다', async () => {
    for (const keys of [['Up', 'Down', 'Tab'], ['Down', 'Esc'], ['3']] as const) {
      mocks.getActor.mockResolvedValue(ME)
      ownerSeat()
      const calls = mockAdmin({ agent_watchers: [watcherRow()] }, enqOk())
      expect(await sendConsoleKeys(LANE, REQ, keys)).toMatchObject({ ok: true })
      expect(calls.rpc[0][1]).toMatchObject({ p_keys: keys })
    }
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    mockAdmin()
    const r = await sendConsoleKeys(LANE, REQ, ['1', 'Enter'])
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.error).toContain('확정 키'); expect(r.error).toContain('Tab') }
  })
  it('조정 레인이 아닌 대상(팀장·팀원·조정 팀장·대상 아님)은 bad_target, 비로그인은 unauthorized', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    for (const k of ['me/mbp/lead', 'me/mbp/w1', 'me/mbp/coord:0f8a8f92', 'me/mbp/poll', 'bad']) {
      const calls = mockAdmin({ agent_watchers: [watcherRow()] }, enqOk())
      expect(await sendConsoleKeys(k, REQ, ['1'])).toMatchObject({ ok: false, code: 'bad_target' })
      expect(calls.rpc).toHaveLength(0)
    }
    mocks.getActor.mockResolvedValue(null)
    expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ code: 'unauthorized' })
  })
  it('입력 요청이 없으면 no_request — 행 없음·null·형식 깨짐·sha 없음·감시자 생존 시간 초과', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const cases: Array<{ data: unknown }> = [
      { data: null },
      { data: { input_request: null, last_seen_at: new Date().toISOString() } },
      { data: { input_request: { v: 1, kind: 'permission' }, last_seen_at: new Date().toISOString() } },
      { data: { input_request: { ...storedReq(), sha: undefined }, last_seen_at: new Date().toISOString() } },
      { data: { input_request: { ...storedReq(), sha: 'xyz' }, last_seen_at: new Date().toISOString() } },
      watcherRow({}, 71 * 60_000),
      { data: { input_request: storedReq(), last_seen_at: 'garbage' } },
    ]
    for (const row of cases) {
      const calls = mockAdmin({ agent_watchers: [row] }, enqOk())
      expect(await sendConsoleKeys(LANE, REQ, ['1']), JSON.stringify(row)).toMatchObject({ ok: false, code: 'no_request' })
      expect(calls.rpc).toHaveLength(0)
    }
  })
  it('이미 처리됨(handled)이거나 답할 수 없는 종류(usage-limit·trust·message)는 not_answerable', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const cases = [
      { handled: { by: 'coordinator', at: SINCE } }, { handled: { by: 'auto', at: SINCE } },
      { kind: 'usage-limit' }, { kind: 'trust' }, { kind: 'message' },
    ]
    for (const over of cases) {
      const calls = mockAdmin({ agent_watchers: [watcherRow(over)] }, enqOk())
      const kind = (over as { kind?: string }).kind ?? 'permission'
      expect(await sendConsoleKeys(LANE, { ...REQ, kind }, ['1']), JSON.stringify(over)).toMatchObject({ ok: false, code: 'not_answerable' })
      expect(calls.rpc).toHaveLength(0)
    }
  })
  it('since·kind·sha 중 하나라도 저장값과 다르면 prompt_changed — 형식이 틀린 요청도', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const bad: unknown[] = [
      { ...REQ, since: '2026-10-06T01:00:01.000Z' }, { ...REQ, kind: 'question' }, { ...REQ, sha: 'cd'.repeat(32) },
      { ...REQ, sha: SHA.toUpperCase() }, { kind: REQ.kind, since: REQ.since }, {}, null, undefined, 'x', { ...REQ, since: 1 },
    ]
    for (const req of bad) {
      const calls = mockAdmin({ agent_watchers: [watcherRow()] }, enqOk())
      expect(await sendConsoleKeys(LANE, req as never, ['1']), JSON.stringify(req)).toMatchObject({ ok: false, code: 'prompt_changed' })
      expect(calls.rpc).toHaveLength(0)
    }
  })
  it('DB 결과 — already_sent·rate_limited·queue_full 을 그대로 알린다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    for (const outcome of ['already_sent', 'rate_limited', 'queue_full']) {
      mockAdmin({ agent_watchers: [watcherRow()] }, { agent_console_enqueue_keys: [{ data: [{ outcome, id: null }] }] })
      expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: outcome })
    }
    mockAdmin({ agent_watchers: [watcherRow()] }, { agent_console_enqueue_keys: [{ data: [{ outcome: 'weird', id: null }] }] })
    expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: 'error' })
    mockAdmin({ agent_watchers: [watcherRow()] }, { agent_console_enqueue_keys: [{ error: { message: 'boom' } }] })
    expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: 'error' })
  })
  it('입력 요청 조회 실패는 error(fail-closed) — 없음으로 위장하지 않고 큐에도 넣지 않는다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const calls = mockAdmin({ agent_watchers: [{ error: { message: 'pool' } }] }, enqOk())
    expect(await sendConsoleKeys(LANE, REQ, ['1'])).toMatchObject({ ok: false, code: 'error' })
    expect(calls.rpc).toHaveLength(0)
  })
  it('오류 문구는 한국어 문장이고 내부 오류 상세를 담지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    mockAdmin({ agent_watchers: [{ error: { message: 'SECRET-DB-DETAIL' } }] })
    const a = await sendConsoleKeys(LANE, REQ, ['1'])
    mockAdmin({ agent_watchers: [watcherRow()] }, { agent_console_enqueue_keys: [{ error: { message: 'SECRET-RPC-DETAIL' } }] })
    const b = await sendConsoleKeys(LANE, REQ, ['1'])
    for (const r of [a, b]) {
      expect(r.ok).toBe(false)
      if (!r.ok) { expect(r.error).not.toContain('SECRET'); expect(r.error).toMatch(/[가-힣]/) }
    }
    expect(JSON.stringify(spy.mock.calls)).toContain('SECRET-DB-DETAIL') // 상세는 로그에만
    spy.mockRestore()
  })
})

describe('getConsoleView — inputRequest(발췌 노출 권한은 화면 보기와 같다)', () => {
  const screenRow = { lines: ['$ ls'], captured_at: new Date(NOW - 30_000).toISOString(), updated_at: new Date(NOW - 30_000).toISOString() }
  const VIEW = { kind: 'permission', since: SINCE, handled: null, excerpt: ['Allow Bash?', '1. Yes', '2. No'], sha: SHA }
  it('본인 — 발췌·해시가 담긴 입력 요청을 본다(본인 감시자 행에서)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const calls = mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [watcherRow()] })
    const v = await getConsoleView(LANE)
    expect(v).toMatchObject({ ok: true, canView: true, inputRequest: VIEW })
    expect(calls.ops).toContainEqual(['agent_watchers', 'eq', ['user_id', 'u-me']])
    expect(calls.ops).toContainEqual(['agent_watchers', 'eq', ['agent', LANE]])
  })
  it('입력 요청이 없으면 null(칸은 있다)', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [{ data: { input_request: null, last_seen_at: new Date().toISOString() } }] })
    const v = await getConsoleView(LANE)
    expect(v.ok && v.inputRequest).toBeNull()
    expect(v.ok && 'inputRequestError' in v).toBe(false)
  })
  it('처리된 입력 요청은 handled 와 함께 보인다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [watcherRow({ handled: { by: 'coordinator', at: SINCE } })] })
    expect(await getConsoleView(LANE)).toMatchObject({ inputRequest: { handled: { by: 'coordinator', at: SINCE } } })
  })
  it('조정 세션(coord_lane·coord_lead) 좌석은 관리자·슈퍼유저·같은 프로젝트 멤버에게 화면·발췌가 비어 있다 — 감시자 행의 project_id 가 낡을 수 있다', async () => {
    const MEMBER = actor('u-member', [[P1, 'member']])
    for (const seat of [LANE, 'me/mbp/coord:0f8a8f92']) {
      for (const who of [ADMIN, SUPER, MEMBER]) {
        mocks.getActor.mockResolvedValue(who)
        mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
        mocks.fetchConsoleSeats.mockResolvedValue([{ kind: seat === LANE ? 'coord_lane' : 'coord_lead', ref: seat === LANE ? 'kit' : '0f8a8f92', host: 'mbp', projectId: P1 }])
        const calls = mockAdmin({ agent_console_screens: [{ data: screenRow }], agent_watchers: [watcherRow()] })
        const v = await getConsoleView(seat)
        expect(v, seat).toMatchObject({ ok: true, canSend: false, canView: false })
        expect(v.ok && ('screen' in v || 'inputRequest' in v || 'inputRequestError' in v || 'prompts' in v)).toBe(false)
        expect(calls.ops).toHaveLength(0)
        expect(mocks.fetchConsoleSeats).not.toHaveBeenCalled()
        mocks.fetchConsoleSeats.mockClear()
      }
    }
  })
  it('조정 세션도 본인은 화면·발췌를 본다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [watcherRow()] })
    expect(await getConsoleView(LANE)).toMatchObject({ ok: true, canView: true, screen: { lines: ['$ ls'] }, inputRequest: VIEW })
  })
  it('팀장·팀원 좌석은 종전대로 그 좌석 프로젝트의 관리자가 화면을 본다(입력 요청 칸은 없다)', async () => {
    for (const [seat, kind, ref] of [['me/mbp/lead', 'team_lead', 'lead'], ['me/mbp/w1', 'team_worker', 'w1']] as const) {
      mocks.getActor.mockResolvedValue(ADMIN)
      mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
      mocks.fetchConsoleSeats.mockResolvedValue([{ kind, ref, host: 'mbp', projectId: P1 }])
      const calls = mockAdmin({ agent_console_screens: [{ data: screenRow }] })
      const v = await getConsoleView(seat)
      expect(v, seat).toMatchObject({ ok: true, canSend: false, canView: true, screen: { lines: ['$ ls'] } })
      expect(v.ok && 'inputRequest' in v).toBe(false)
      expect(calls.ops).toContainEqual(['agent_console_screens', 'eq', ['owner', 'u-me']])
    }
  })
  it('열람 권한이 없으면(다른 프로젝트 관리자·프로젝트 없음) inputRequest 칸 자체가 없고 감시자 행도 읽지 않는다', async () => {
    mocks.getActor.mockResolvedValue(actor('u-x', [['other', 'admin']]))
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: P1 }])
    mocks.fetchConsoleSeats.mockResolvedValue([{ kind: 'coord_lane', ref: 'kit', host: 'mbp', projectId: P1 }])
    const a = mockAdmin({ agent_watchers: [watcherRow()] })
    const v = await getConsoleView(LANE)
    expect(v).toMatchObject({ ok: true, canView: false })
    expect(v.ok && 'inputRequest' in v).toBe(false)
    expect(v.ok && 'inputRequestError' in v).toBe(false)
    expect(a.ops.some(o => o[0] === 'agent_watchers')).toBe(false)
    mocks.getActor.mockResolvedValue(SUPER)
    mocks.fetchConsoleSeatOwners.mockResolvedValue([{ owner: 'u-me', projectId: null }])
    mocks.fetchConsoleSeats.mockResolvedValue([{ kind: 'coord_lane', ref: 'kit', host: 'mbp', projectId: null }])
    const b = mockAdmin({ agent_watchers: [watcherRow()] })
    const v2 = await getConsoleView(LANE)
    expect(v2.ok && 'inputRequest' in v2).toBe(false)
    expect(b.ops).toHaveLength(0)
  })
  it('조회 실패·형식 깨짐은 없음으로 위장하지 않는다 — inputRequestError 를 싣고 inputRequest 는 비운다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [{ error: { message: 'x' } }] })
    const a = await getConsoleView(LANE)
    expect(a).toMatchObject({ ok: true, canView: true, inputRequestError: '입력 요청 조회에 실패했습니다.' })
    expect(a.ok && 'inputRequest' in a).toBe(false)
    mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [{ data: { input_request: { v: 1, kind: 'permission' }, last_seen_at: new Date().toISOString() } }] })
    const b = await getConsoleView(LANE)
    expect(b).toMatchObject({ ok: true, inputRequestError: expect.stringContaining('형식') })
    expect(b.ok && 'inputRequest' in b).toBe(false)
  })
  it('레인이 아닌 좌석(팀원)은 입력 요청을 읽지 않는다', async () => {
    mocks.getActor.mockResolvedValue(ME)
    ownerSeat()
    const calls = mockAdmin({ agent_console_prompts: [{ data: [] }], agent_console_screens: [{ data: screenRow }], agent_watchers: [watcherRow()] })
    const v = await getConsoleView('me/mbp/w1')
    expect(v.ok && 'inputRequest' in v).toBe(false)
    expect(calls.ops.some(o => o[0] === 'agent_watchers')).toBe(false)
  })
})
