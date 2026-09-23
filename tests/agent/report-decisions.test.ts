// 완료 보고의 결정 목록(과제 C, 스펙 §4.1). PAT completion 에서만 받고, 형식 오류는 DB 접근 전 400.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
  // 인자 타입을 적어 둔다 — mock.calls[0][0].payload 를 tsc 가 읽을 수 있게.
  emitNotification: vi.fn(async (_n: { payload: { detail: string } }) => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const RPC_OK = { ok: true, order_status: 'reported', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: 'no_item' }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read', 'work:claim'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const CLAIMED = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: 'u-1', wbs_item_id: null }
const ctx = { params: Promise.resolve({ id: O1 }) }
const D = (key: string, over: Record<string, unknown> = {}) => ({
  key, question: ' 넣는가? ', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향', ...over,
})

function useAdmin(queues: Record<string, Resp[]>) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'delete', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => ({ data: RPC_OK, error: null })),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users: [{ id: 'u-1', email: 'dev@example.com', user_metadata: {} }] }, error: null })),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, inserts }
}
const patQueues = (): Record<string, Resp[]> => ({
  agent_runners: [{ data: RUNNER }, { data: null }],
  agent_work_orders: [{ data: CLAIMED }],
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }, { data: [{ user_id: 'admin-1' }] }],
  agent_work_reports: [{ data: [{ id: 'r-1' }] }],
})
const post = (body: unknown, bearer = PAT.token) => new NextRequest(`http://l/api/v1/agent/work/${O1}/report`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})
const COMPLETION = { agent: 'a', kind: 'completion', percent: 100, summary: '끝' }
const reportInsert = (inserts: Array<{ table: string; row: Record<string, unknown> }>) =>
  inserts.find(i => i.table === 'agent_work_reports')?.row

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST report — decisions', () => {
  it('필드가 없으면 insert 에 decisions 키가 없고 응답 decisions_recorded 는 null', async () => {
    const { inserts } = useAdmin(patQueues())
    const res = await reportPOST(post(COMPLETION), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'reported', decisions_recorded: null })
    expect(reportInsert(inserts)).not.toHaveProperty('decisions')
    expect(mocks.emitNotification.mock.calls[0][0].payload.detail).toBe('완료 보고 — 승인 대기')
  })
  it('[] 는 0건 명시로 저장하고 응답은 0, 알림 문구는 종전 그대로', async () => {
    const { inserts } = useAdmin(patQueues())
    const res = await reportPOST(post({ ...COMPLETION, decisions: [] }), ctx)
    expect(await res.json()).toEqual({ ok: true, status: 'reported', decisions_recorded: 0 })
    expect(reportInsert(inserts)?.decisions).toEqual([])
    expect(mocks.emitNotification.mock.calls[0][0].payload.detail).toBe('완료 보고 — 승인 대기')
  })
  it('2건은 trim 해 저장하고 응답 2, 알림에 결정 수를 싣는다', async () => {
    const { inserts } = useAdmin(patQueues())
    const res = await reportPOST(post({ ...COMPLETION, decisions: [D('D1'), D('D2', { chosen: 1 })] }), ctx)
    expect(await res.json()).toEqual({ ok: true, status: 'reported', decisions_recorded: 2 })
    const saved = reportInsert(inserts)?.decisions as Array<Record<string, unknown>>
    expect(saved).toHaveLength(2)
    expect(saved[0].question).toBe('넣는가?')
    expect(saved[1].chosen).toBe(1)
    expect(mocks.emitNotification.mock.calls[0][0].payload.detail).toBe('완료 보고 — 승인 대기 · 확인 필요 결정 2건')
  })
  it('progress 에 decisions 가 실리면 400 — DB 에 가지 않는다(형식이 틀려도 이 사유가 먼저다)', async () => {
    useAdmin(patQueues())
    const res = await reportPOST(post({ agent: 'a', kind: 'progress', percent: 10, summary: 's', decisions: 'bad' }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('decisions는 완료 보고(kind=completion)에서만 받습니다.')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('형식 위반은 필드 경로를 담은 400 — DB 에 가지 않는다', async () => {
    useAdmin(patQueues())
    const res = await reportPOST(post({ ...COMPLETION, decisions: [D('D1', { chosen: 5 })] }), ctx)
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.code).toBe('validation_failed')
    expect(j.error).toBe('decisions[0].chosen이 options 범위를 벗어났습니다.')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('레거시(v1) 호출의 decisions 는 400 — 보고 행을 쓰지 않는다', async () => {
    const { inserts } = useAdmin({})
    const res = await reportPOST(post({ ...COMPLETION, user_email: 'dev@example.com', agent: 'cli-1', decisions: [] }, 'legacy-secret'), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('decisions는 PAT 호출에서만 받습니다.')
    expect(inserts).toHaveLength(0)
  })
})
