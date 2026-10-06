// tests/agent/console-routes.test.ts — 콘솔 로컬 API(poll·ack·screen)와 watch 의 console 칸(계약 §2.12).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST as poll } from '@/app/api/v1/agent/console/poll/route'
import { POST as ack } from '@/app/api/v1/agent/console/ack/route'
import { POST as screen } from '@/app/api/v1/agent/console/screen/route'
import { POST as watch } from '@/app/api/v1/agent/watch/route'

type Resp = { data?: unknown; error?: { message: string; code?: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null as string | null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const ID = '11111111-1111-4111-8111-111111111111'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

interface Calls { rpc: Array<[string, Record<string, unknown>]>; ops: Array<[string, string, unknown[]]> }
function mockAdmin(queues: Record<string, Resp[]>, rpc: Record<string, Resp[]> = {}, runner = RUNNER): Calls {
  const calls: Calls = { rpc: [], ops: [] }
  const q: Record<string, Resp[]> = { agent_runners: [{ data: runner }, { data: null }], ...queues }
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (q[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'gte', 'gt', 'lt', 'not', 'in', 'or', 'order', 'limit', 'update', 'upsert', 'delete']) {
        b[k] = (...a: unknown[]) => { calls.ops.push([table, k, a]); return b }
      }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push([fn, args])
      const resp = (rpc[fn] ?? []).shift() ?? { data: [], error: null }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return calls
}
const call = (fn: (r: NextRequest) => Promise<Response>, path: string, body: unknown, bearer: string = PAT.token) =>
  fn(new NextRequest(`http://l/api/v1/agent/console/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('공통 게이트', () => {
  it('레거시 시크릿은 400 identity_required, 스코프가 없으면 403', async () => {
    mockAdmin({})
    const legacy = await call(poll, 'poll', { host: 'mbp' }, 'legacy-secret')
    expect(legacy.status).toBe(400)
    expect((await legacy.json()).code).toBe('identity_required')
    mockAdmin({}, {}, { ...RUNNER, scopes: ['work:read'] })
    expect((await call(poll, 'poll', { host: 'mbp' })).status).toBe(403)
  })
  it('API 가 꺼져 있으면 본문이 깨져 있어도 404 — 본문보다 인증을 먼저 본다', async () => {
    process.env.AGENT_API_ENABLED = 'false'
    mockAdmin({})
    expect((await call(ack, 'ack', {})).status).toBe(404)
    mockAdmin({})
    const res = await poll(new NextRequest('http://l/api/v1/agent/console/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }))
    expect(res.status).toBe(404)
  })
  it('토큰이 없으면 본문을 읽기 전에 401, 인증 뒤 배열·깨진 본문은 400', async () => {
    mockAdmin({})
    expect((await poll(new NextRequest('http://l/x', { method: 'POST', body: '{not json' }))).status).toBe(401)
    mockAdmin({})
    expect((await call(poll, 'poll', [1, 2])).status).toBe(400)
  })
})

describe('프로젝트 한정 PAT — 조정 세션 칸(프로젝트 없는 보조 대상)만', () => {
  const LIMITED = { ...RUNNER, project_id: 'p1' }
  const TOKEN = 'a'.repeat(32)
  const CLAIMED = { id: ID, target_kind: 'coord_lane', target_ref: 'kit', text: '안녕', expires_at: '2099-01-01T00:00:00Z', token_index: 1,
    input_kind: 'text', keys: null, req_kind: null, req_since: null, req_sha: null }
  it('poll — p_target_kinds=[coord_lead, coord_lane] 로 집고 행을 돌려준다(글 행·키 행 모두)', async () => {
    const keyRow = { ...CLAIMED, id: '22222222-2222-4222-8222-222222222222', token_index: 2, input_kind: 'keys', keys: ['1'], req_kind: 'permission', req_since: '2026-10-06T00:00:00Z', req_sha: 'b'.repeat(64) }
    const calls = mockAdmin({}, { agent_console_claim: [{ data: [CLAIMED, keyRow] }] }, LIMITED)
    const res = await call(poll, 'poll', { host: 'mbp', accepts: ['keys'] })
    expect(res.status).toBe(200)
    const { prompts } = await res.json()
    expect(prompts.map((p: { id: string; kind?: string }) => [p.id, p.kind ?? 'text'])).toEqual([[ID, 'text'], [keyRow.id, 'keys']])
    expect(calls.rpc[0][1]).toMatchObject({ p_owner: 'u-1', p_host: 'mbp', p_accept_keys: true, p_target_kinds: ['coord_lead', 'coord_lane'] })
  })
  it('한정 없는 PAT 는 p_target_kinds 를 싣지 않는다 — 옛 호출 모양 그대로(회귀)', async () => {
    const calls = mockAdmin({}, { agent_console_claim: [{ data: [] }] })
    expect((await call(poll, 'poll', { host: 'mbp' })).status).toBe(200)
    expect(Object.keys(calls.rpc[0][1]).sort()).toEqual(['p_host', 'p_owner', 'p_token_hashes'])
  })
  it('ack — 조정 세션 칸 행은 RPC 로 닫는다(owner 로 행을 먼저 본다)', async () => {
    const calls = mockAdmin({ agent_console_prompts: [{ data: { target_kind: 'coord_lead' } }] },
      { agent_console_ack: [{ data: [{ outcome: 'ok', status: 'sent' }] }] }, LIMITED)
    const res = await call(ack, 'ack', { id: ID, claim_token: TOKEN, result: 'sent', detail: 'submitted' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'sent' })
    expect(calls.ops.filter(o => o[0] === 'agent_console_prompts' && o[1] === 'eq').map(o => o[2])).toEqual([['id', ID], ['owner', 'u-1']])
    expect(calls.rpc[0][0]).toBe('agent_console_ack')
  })
  it('ack — team 대상 행·없는 행·남의 행은 RPC 없이 404(존재 비구분)', async () => {
    for (const row of [{ target_kind: 'team_worker' }, { target_kind: 'team_lead' }, null]) {
      const calls = mockAdmin({ agent_console_prompts: [{ data: row }] }, {}, LIMITED)
      const res = await call(ack, 'ack', { id: ID, claim_token: TOKEN, result: 'sent', detail: 'submitted' })
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('not_found')
      expect(calls.rpc).toHaveLength(0)
    }
  })
  it('ack — 행 조회 실패는 500(거절로 위장하지 않는다), 한정 없는 PAT 는 행 조회 없이 RPC', async () => {
    const calls = mockAdmin({ agent_console_prompts: [{ error: { message: 'pool' } }] }, {}, LIMITED)
    expect((await call(ack, 'ack', { id: ID, claim_token: TOKEN, result: 'sent', detail: 'submitted' })).status).toBe(500)
    expect(calls.rpc).toHaveLength(0)
    const free = mockAdmin({}, { agent_console_ack: [{ data: [{ outcome: 'ok', status: 'sent' }] }] })
    expect((await call(ack, 'ack', { id: ID, claim_token: TOKEN, result: 'sent', detail: 'submitted' })).status).toBe(200)
    expect(free.ops.filter(o => o[0] === 'agent_console_prompts')).toHaveLength(0)
  })
})

describe('POST /console/poll', () => {
  it('owner·host 로 claim 하고, 토큰 원문은 응답에만·DB 에는 해시만, token_index 순으로 짝을 맞춘다', async () => {
    const calls = mockAdmin({}, {
      agent_console_claim: [{ data: [
        { id: 'b', target_kind: 'team_worker', target_ref: 'w2', text: '둘', expires_at: 'x', token_index: 2 },
        { id: 'a', target_kind: 'coord_lane', target_ref: 'kit', text: '하나', expires_at: 'x', token_index: 1 },
      ] }],
    })
    const res = await call(poll, 'poll', { host: 'mbp', limit: 2 })
    expect(res.status).toBe(200)
    const body = await res.json()
    const [fn, args] = calls.rpc[0]
    expect(fn).toBe('agent_console_claim')
    expect(args.p_owner).toBe('u-1')
    expect(args.p_host).toBe('mbp')
    const hashes = args.p_token_hashes as string[]
    expect(hashes).toHaveLength(2)
    expect(body.prompts.map((p: { id: string }) => p.id)).toEqual(['a', 'b'])
    for (const [i, p] of (body.prompts as Array<{ claim_token: string }>).entries()) {
      expect(p.claim_token).toMatch(/^[0-9a-f]{32}$/)
      expect(sha(p.claim_token)).toBe(hashes[i])
      expect(hashes).not.toContain(p.claim_token)
    }
  })
  const KEYS_ROW = {
    id: 'k', target_kind: 'coord_lane', target_ref: 'kit', text: '키: Down Enter', expires_at: 'x', token_index: 2,
    input_kind: 'keys', keys: ['Down', 'Enter'], req_kind: 'permission', req_since: '2026-10-06T01:00:00+00:00', req_sha: 'ab'.repeat(32),
  }
  const TEXT_ROW = { id: 't', target_kind: 'coord_lane', target_ref: 'kit', text: '하나', expires_at: 'x', token_index: 1,
    input_kind: 'text', keys: null, req_kind: null, req_since: null, req_sha: null }
  it('키 행 — accepts 에 keys 가 있으면 p_accept_keys=true 로 집고, kind·keys·input_request 만 싣는다(text 없음). 글 행의 모양은 그대로다', async () => {
    const calls = mockAdmin({}, { agent_console_claim: [{ data: [KEYS_ROW, TEXT_ROW] }] })
    const body = await (await call(poll, 'poll', { host: 'mbp', limit: 2, accepts: ['keys'] })).json()
    expect(calls.rpc[0][1]).toMatchObject({ p_accept_keys: true })
    expect(body.prompts).toHaveLength(2)
    const [text, keys] = body.prompts
    expect(Object.keys(text).sort()).toEqual(['claim_token', 'expires_at', 'id', 'target_kind', 'target_ref', 'text'])
    expect(Object.keys(keys).sort()).toEqual(['claim_token', 'expires_at', 'id', 'input_request', 'keys', 'kind', 'target_kind', 'target_ref'])
    expect(keys).toMatchObject({
      id: 'k', target_kind: 'coord_lane', target_ref: 'kit', kind: 'keys', keys: ['Down', 'Enter'],
      input_request: { kind: 'permission', since: '2026-10-06T01:00:00.000Z', sha: 'ab'.repeat(32) },
    })
    expect(keys.claim_token).toMatch(/^[0-9a-f]{32}$/)
  })
  it('accepts 가 없는 옛 폴러는 p_accept_keys 인자를 아예 싣지 않는다(옛 3인자 호출과 같은 모양) — 키 행을 집지 않으므로 ack 로 닫는 일도 없다', async () => {
    for (const bodyIn of [{ host: 'mbp' }, { host: 'mbp', accepts: [] }, { host: 'mbp', accepts: ['other'] }]) {
      const calls = mockAdmin({}, { agent_console_claim: [{ data: [TEXT_ROW] }] })
      const body = await (await call(poll, 'poll', bodyIn)).json()
      expect(calls.rpc).toHaveLength(1)
      expect(Object.keys(calls.rpc[0][1]).sort()).toEqual(['p_host', 'p_owner', 'p_token_hashes'])
      expect(body.prompts.map((p: { id: string }) => p.id)).toEqual(['t'])
    }
  })
  it('방어: DB 가 accept 없이 키 행을 돌려줘도 응답에 싣지 않는다(ack 도 하지 않아 상태는 건드리지 않는다)', async () => {
    const calls = mockAdmin({}, { agent_console_claim: [{ data: [KEYS_ROW, TEXT_ROW] }] })
    const body = await (await call(poll, 'poll', { host: 'mbp', limit: 2 })).json()
    expect(body.prompts.map((p: { id: string }) => p.id)).toEqual(['t'])
    expect(calls.rpc.map(r => r[0])).toEqual(['agent_console_claim'])
  })
  it('키 행이 깨져 있으면(순서 규칙 위반·키 목록 밖·칸 없음) 응답에 싣지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const broken of [{ keys: ['1', 'Enter'] }, { keys: ['Enter', 'Up'] }, { keys: ['Tab', 'Enter'] }, { keys: ['Tab', '1'] }, { keys: ['F5'] }, { keys: null }, { req_sha: null }, { req_since: 'garbage' }, { req_kind: null }]) {
      mockAdmin({}, { agent_console_claim: [{ data: [{ ...KEYS_ROW, ...broken }] }] })
      const body = await (await call(poll, 'poll', { host: 'mbp', accepts: ['keys'] })).json()
      expect(body.prompts, JSON.stringify(broken)).toEqual([])
    }
    spy.mockRestore()
  })
  it('accepts 형식 오류는 400', async () => {
    for (const bad of ['keys', [1], { keys: true }, Array(11).fill('keys')]) {
      mockAdmin({})
      expect((await call(poll, 'poll', { host: 'mbp', accepts: bad })).status).toBe(400)
    }
  })
  it('limit 기본 5, 범위 밖·host 형식 오류는 400', async () => {
    const calls = mockAdmin({})
    await call(poll, 'poll', { host: 'mbp' })
    expect((calls.rpc[0][1].p_token_hashes as string[]).length).toBe(5)
    for (const bad of [{ host: 'MBP' }, { host: 'mbp', limit: 0 }, { host: 'mbp', limit: 11 }, { host: 'mbp', limit: 1.5 }, {}]) {
      mockAdmin({})
      expect((await call(poll, 'poll', bad)).status).toBe(400)
    }
  })
  it('RPC 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    mockAdmin({}, { agent_console_claim: [{ error: { message: 'boom' } }] })
    expect((await call(poll, 'poll', { host: 'mbp' })).status).toBe(500)
  })
})

describe('POST /console/ack', () => {
  const TOKEN = 'a'.repeat(32)
  const ackBody = (over: Record<string, unknown> = {}) => ({ id: ID, claim_token: TOKEN, result: 'sent', detail: 'submitted', ...over })
  it('ok → 200, 토큰은 해시로 넘긴다', async () => {
    const calls = mockAdmin({}, { agent_console_ack: [{ data: [{ outcome: 'ok', status: 'sent' }] }] })
    const res = await call(ack, 'ack', ackBody())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'sent' })
    expect(calls.rpc[0][1]).toMatchObject({ p_owner: 'u-1', p_id: ID, p_token_hash: sha(TOKEN), p_result: 'sent', p_reason: null, p_detail: 'submitted' })
  })
  it('already → 200 already, conflict → 409, not_found → 404', async () => {
    mockAdmin({}, { agent_console_ack: [{ data: [{ outcome: 'already', status: 'sent' }] }] })
    expect(await (await call(ack, 'ack', ackBody())).json()).toEqual({ ok: true, status: 'sent', already: true })
    mockAdmin({}, { agent_console_ack: [{ data: [{ outcome: 'conflict', status: 'unknown' }] }] })
    const c = await call(ack, 'ack', ackBody())
    expect(c.status).toBe(409)
    expect((await c.json()).code).toBe('conflict')
    mockAdmin({}, { agent_console_ack: [{ data: [{ outcome: 'not_found', status: null }] }] })
    expect((await call(ack, 'ack', ackBody())).status).toBe(404)
  })
  it('토큰 형식이 다르면 RPC 없이 404(존재 비구분), id 형식 오류는 400', async () => {
    const a = mockAdmin({})
    expect((await call(ack, 'ack', ackBody({ claim_token: 'nope' }))).status).toBe(404)
    expect(a.rpc).toHaveLength(0)
    const b = mockAdmin({})
    expect((await call(ack, 'ack', ackBody({ id: 'x' }))).status).toBe(400)
    expect(b.rpc).toHaveLength(0)
  })
  it('계약 규칙 위반은 RPC 전에 400 — 사유 없는 refused·compacting 아닌 retry·목록 밖 사유·sent 아닌 detail', async () => {
    for (const bad of [
      { result: 'refused', detail: undefined }, { result: 'retry', reason: 'stale', detail: undefined },
      { result: 'refused', reason: 'whatever', detail: undefined }, { result: 'refused', reason: 'error', detail: 'submitted' },
      { result: 'done' },
    ]) {
      const calls = mockAdmin({})
      expect((await call(ack, 'ack', ackBody(bad))).status).toBe(400)
      expect(calls.rpc).toHaveLength(0)
    }
  })
  it('prompt_changed — refused 와는 200, sent·retry 와는 RPC 전에 400', async () => {
    const calls = mockAdmin({}, { agent_console_ack: [{ data: [{ outcome: 'ok', status: 'refused' }] }] })
    const res = await call(ack, 'ack', ackBody({ result: 'refused', reason: 'prompt_changed', detail: undefined }))
    expect(res.status).toBe(200)
    expect(calls.rpc[0][1]).toMatchObject({ p_result: 'refused', p_reason: 'prompt_changed', p_detail: null })
    for (const bad of [{ result: 'sent', reason: 'prompt_changed', detail: undefined }, { result: 'retry', reason: 'prompt_changed', detail: undefined }]) {
      const c = mockAdmin({})
      expect((await call(ack, 'ack', ackBody(bad))).status).toBe(400)
      expect(c.rpc).toHaveLength(0)
    }
  })
  it('RPC 의 22023·23514 는 400, 그 밖은 500', async () => {
    mockAdmin({}, { agent_console_ack: [{ error: { message: 'x', code: '22023' } }] })
    expect((await call(ack, 'ack', ackBody())).status).toBe(400)
    mockAdmin({}, { agent_console_ack: [{ error: { message: 'x', code: '40001' } }] })
    expect((await call(ack, 'ack', ackBody())).status).toBe(500)
  })
})

describe('POST /console/screen', () => {
  const seen = new Date().toISOString()
  const seatsQueues = () => ({
    agent_watchers: [{ data: [{ agent: 'hong/mbp/임시:kit·노드 엔진', project_id: null }, { agent: 'hong/other/lead', project_id: null }] }],
    agent_work_orders: [{ data: [{ heartbeat_agent: 'hong/mbp/w1', project_id: 'p1' }] }],
  })
  const item = (over: Record<string, unknown> = {}) => ({ target_kind: 'coord_lane', target_ref: 'kit', sha: 'a'.repeat(64), captured_at: seen, lines: ['$ ls', 'ok'], ...over })
  it('좌석에 있는 대상은 저장, 없는 대상·다른 host 의 대상은 unknown_target, 잘못된 항목만 rejected', async () => {
    const calls = mockAdmin(seatsQueues())
    const res = await call(screen, 'screen', { host: 'mbp', items: [
      item(), item({ target_kind: 'team_worker', target_ref: 'w1' }),
      item({ target_kind: 'team_lead', target_ref: 'lead' }), item({ target_ref: 'other' }),
      item({ target_ref: 'kit', lines: ['bad\u001b[31m'] }),
    ] })
    expect(res.status).toBe(200)
    const { results } = await res.json()
    expect(results.map((r: { status: string; reason?: string }) => r.reason ?? r.status)).toEqual(['stored', 'stored', 'unknown_target', 'unknown_target', 'control_char'])
    // 저장분은 upsert 한 번으로 묶는다
    const ups = calls.ops.filter(o => o[0] === 'agent_console_screens' && o[1] === 'upsert')
    expect(ups).toHaveLength(1)
    const rows = ups[0][2][0] as Array<Record<string, unknown>>
    expect(rows.map(r => `${r.target_kind}/${r.target_ref}`)).toEqual(['coord_lane/kit', 'team_worker/w1'])
    expect(rows[0]).toMatchObject({ owner: 'u-1', host: 'mbp', lines: ['$ ls', 'ok'] })
    expect(ups[0][2][1]).toEqual({ onConflict: 'owner,host,target_kind,target_ref' })
    // 감시자 조회는 이 사용자·살아 있는 행만
    expect(calls.ops).toContainEqual(['agent_watchers', 'eq', ['user_id', 'u-1']])
    expect(calls.ops).toContainEqual(['agent_work_orders', 'eq', ['claimed_by_user_id', 'u-1']])
    // 24시간 지난 화면 정리
    expect(calls.ops.some(o => o[0] === 'agent_console_screens' && o[1] === 'delete')).toBe(true)
  })
  it('touch — 기존 sha 를 한 번 읽어 같으면 touched(같은 시각끼리 갱신 한 번), 다르거나 행이 없으면 need_full', async () => {
    const calls = mockAdmin({ ...seatsQueues(), agent_console_screens: [{ data: [
      { target_kind: 'coord_lane', target_ref: 'kit', sha: 'a'.repeat(64) }, { target_kind: 'team_worker', target_ref: 'w1', sha: 'c'.repeat(64) },
    ] }, { data: [{ target_kind: 'coord_lane', target_ref: 'kit' }, { target_kind: 'team_worker', target_ref: 'w1' }] }, { data: null }] })
    const res = await call(screen, 'screen', { host: 'mbp', items: [
      item({ lines: undefined }), item({ lines: undefined, target_kind: 'team_worker', target_ref: 'w1', sha: 'b'.repeat(64) }),
      item({ lines: undefined, target_kind: 'team_worker', target_ref: 'w1', sha: 'c'.repeat(64) }),
    ] })
    expect((await res.json()).results.map((r: { status: string; reason?: string }) => r.reason ?? r.status)).toEqual(['touched', 'duplicate_target', 'touched'])
    const sel = calls.ops.filter(o => o[0] === 'agent_console_screens' && o[1] === 'eq')
    expect(sel).toEqual(expect.arrayContaining([['agent_console_screens', 'eq', ['owner', 'u-1']], ['agent_console_screens', 'eq', ['host', 'mbp']]]))
    const ors = calls.ops.filter(o => o[0] === 'agent_console_screens' && o[1] === 'or')
    expect(ors).toHaveLength(1)
    expect(ors[0][2][0]).toBe(`and(target_kind.eq.coord_lane,target_ref.eq."kit",sha.eq.${'a'.repeat(64)}),and(target_kind.eq.team_worker,target_ref.eq."w1",sha.eq.${'c'.repeat(64)})`)
  })
  it('touch — 저장된 화면이 없거나 sha 가 다르면 need_full, 갱신하지 않는다', async () => {
    const calls = mockAdmin({ ...seatsQueues(), agent_console_screens: [{ data: [] }] })
    const res = await call(screen, 'screen', { host: 'mbp', items: [item({ lines: undefined })] })
    expect((await res.json()).results[0].status).toBe('need_full')
    expect(calls.ops.some(o => o[0] === 'agent_console_screens' && o[1] === 'update')).toBe(false)
  })
  it('touch — 조회와 갱신 사이에 행이 바뀌어 갱신되지 않은 대상은 need_full', async () => {
    mockAdmin({ ...seatsQueues(), agent_console_screens: [{ data: [{ target_kind: 'coord_lane', target_ref: 'kit', sha: 'a'.repeat(64) }] }, { data: [] }] })
    const res = await call(screen, 'screen', { host: 'mbp', items: [item({ lines: undefined })] })
    expect((await res.json()).results[0].status).toBe('need_full')
  })
  it('프로젝트 한정 PAT — 같은 화면 행을 쓰는 좌석이 다른 프로젝트에도 있으면 unknown_target(덮어쓰기 금지)', async () => {
    mockAdmin({
      agent_watchers: [{ data: [] }],
      agent_work_orders: [{ data: [{ heartbeat_agent: 'hong/mbp/w1', project_id: 'p1' }, { heartbeat_agent: 'hong/mbp/w1', project_id: 'p2' }] }],
    }, {}, { ...RUNNER, project_id: 'p1' })
    const res = await call(screen, 'screen', { host: 'mbp', items: [item({ target_kind: 'team_worker', target_ref: 'w1' })] })
    expect((await res.json()).results[0].reason).toBe('unknown_target')
  })
  it('DB 쓰기 실패는 항목 사유로 감추지 않고 500', async () => {
    mockAdmin({ ...seatsQueues(), agent_console_screens: [{ error: { message: 'pool' } }] })
    expect((await call(screen, 'screen', { host: 'mbp', items: [item()] })).status).toBe(500)
  })
  it('프로젝트 한정 PAT — 프로젝트 없는 조정 세션 칸과 자기 프로젝트 좌석은 stored, 프로젝트 없는 team 좌석·남의 프로젝트 team 좌석은 unknown_target', async () => {
    const calls = mockAdmin({
      agent_watchers: [{ data: [
        { agent: 'hong/mbp/임시:kit·노드 엔진', project_id: null }, { agent: 'hong/mbp/coord:abcd1234', project_id: null }, { agent: 'hong/mbp/lead', project_id: null },
      ] }],
      agent_work_orders: [{ data: [{ heartbeat_agent: 'hong/mbp/w1', project_id: 'p1' }, { heartbeat_agent: 'hong/mbp/w2', project_id: 'p2' }] }],
    }, {}, { ...RUNNER, project_id: 'p1' })
    const res = await call(screen, 'screen', { host: 'mbp', items: [
      item(), item({ target_kind: 'coord_lead', target_ref: 'abcd1234' }), item({ target_kind: 'team_worker', target_ref: 'w1' }),
      item({ target_kind: 'team_worker', target_ref: 'w2' }), item({ target_kind: 'team_lead', target_ref: 'lead' }),
    ] })
    expect((await res.json()).results.map((r: { status: string; reason?: string }) => r.reason ?? r.status))
      .toEqual(['stored', 'stored', 'stored', 'unknown_target', 'unknown_target'])
    const rows = calls.ops.find(o => o[0] === 'agent_console_screens' && o[1] === 'upsert')![2][0] as Array<Record<string, unknown>>
    expect(rows.map(r => `${r.target_kind}/${r.target_ref}`)).toEqual(['coord_lane/kit', 'coord_lead/abcd1234', 'team_worker/w1'])
  })
  it('프로젝트 한정 PAT — 한 열쇠에 보조 좌석과 프로젝트 있는 좌석이 섞이면 unknown_target(fail-closed)', async () => {
    mockAdmin({
      agent_watchers: [{ data: [{ agent: 'hong/mbp/임시:kit·노드 엔진', project_id: null }, { agent: 'hong/mbp/임시:kit·옛 요약', project_id: 'p9' }] }],
      agent_work_orders: [{ data: [] }],
    }, {}, { ...RUNNER, project_id: 'p1' })
    const res = await call(screen, 'screen', { host: 'mbp', items: [item()] })
    expect((await res.json()).results[0].reason).toBe('unknown_target')
  })
  it('프로젝트 한정 PAT — 자기 프로젝트 좌석과 보조 좌석이 한 열쇠에 섞여도 거절(어느 쪽 화면도 덮어쓰지 않는다)', async () => {
    mockAdmin({
      agent_watchers: [{ data: [{ agent: 'hong/mbp/임시:kit·노드 엔진', project_id: null }, { agent: 'hong/mbp/임시:kit·옛 요약', project_id: 'p1' }] }],
      agent_work_orders: [{ data: [] }],
    }, {}, { ...RUNNER, project_id: 'p1' })
    expect((await (await call(screen, 'screen', { host: 'mbp', items: [item()] })).json()).results[0].reason).toBe('unknown_target')
  })
  it('다른 owner 의 좌석은 어떤 PAT 로도 대상이 아니다 — 좌석 조회가 owner 로 걸러진다', async () => {
    const calls = mockAdmin(seatsQueues(), {}, { ...RUNNER, project_id: 'p1' })
    await call(screen, 'screen', { host: 'mbp', items: [item()] })
    expect(calls.ops.filter(o => ['agent_watchers', 'agent_work_orders'].includes(o[0]) && o[1] === 'eq')
      .map(o => o[2])).toEqual(expect.arrayContaining([['user_id', 'u-1'], ['claimed_by_user_id', 'u-1']]))
  })
  it('로그에 토큰 원문·화면 본문을 남기지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAdmin({ ...seatsQueues(), agent_console_screens: [{ error: { message: 'pool' } }] })
    await call(screen, 'screen', { host: 'mbp', items: [item({ lines: ['secret-line'] })] })
    mockAdmin({}, { agent_console_ack: [{ error: { message: 'x', code: '40001' } }] })
    await call(ack, 'ack', { id: ID, claim_token: 'b'.repeat(32), result: 'sent' })
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toContain('secret-line')
    expect(logged).not.toContain('b'.repeat(32))
    spy.mockRestore()
  })
  it('한도 — 41줄·401자 줄·8KB 초과·잘못된 sha 는 rejected, items 21개·host 오류는 400', async () => {
    mockAdmin(seatsQueues())
    const res = await call(screen, 'screen', { host: 'mbp', items: [
      item({ lines: Array(41).fill('x') }), item({ lines: ['x'.repeat(401)] }),
      item({ lines: Array(40).fill('가'.repeat(69)) }), item({ sha: 'XYZ' }),
    ] })
    expect((await res.json()).results.map((r: { reason?: string }) => r.reason)).toEqual(['too_many_lines', 'line_too_long', 'too_large', 'invalid_sha'])
    mockAdmin(seatsQueues())
    expect((await call(screen, 'screen', { host: 'mbp', items: Array(21).fill(item()) })).status).toBe(400)
    mockAdmin(seatsQueues())
    expect((await call(screen, 'screen', { host: 'MBP', items: [] })).status).toBe(400)
  })
  it('좌석 조회 실패는 500 — 모든 항목을 거절하는 것으로 위장하지 않는다', async () => {
    mockAdmin({ agent_watchers: [{ error: { message: 'boom' } }] })
    expect((await call(screen, 'screen', { host: 'mbp', items: [item()] })).status).toBe(500)
  })
})

describe('POST /agent/watch — console 칸', () => {
  it('성공 응답에 console {v:1, poll_s:30} 을 싣는다', async () => {
    mockAdmin({ agent_watchers: [{ data: null }, { data: null }] })
    const res = await watch(new NextRequest('http://l/api/v1/agent/watch', {
      method: 'POST', headers: { Authorization: `Bearer ${PAT.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'hong/mbp/lead' }),
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).console).toEqual({ v: 1, poll_s: 30 })
  })
})
