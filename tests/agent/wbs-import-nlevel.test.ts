import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import { toRpcNode, validateLevels, type LevelDecl } from '@/lib/agent/wbsImport'

/** 계약 v2.2(nlevel) — 스펙 docs/superpowers/specs/2026-08-21-wbs-nlevel-md-contract.md §import 계약 v2.2 */

const LEVELS: LevelDecl[] = [
  { name: 'Phase', prefix: 'PH', progress: 'rollup' },
  { name: 'System', prefix: 'SYS', progress: 'rollup' },
  { name: 'Subsystem', prefix: 'SUB', progress: 'rollup' },
  { name: 'WP', prefix: 'WP', progress: 'rollup', report: 'weekly' },
  { name: 'Activity', prefix: 'ACT', progress: 'rollup', optional: true },
  { name: 'Task', prefix: 'TSK', progress: 'input' },
  { name: 'SubTask', prefix: 'STK', progress: 'checklist', optional: true, upload: 'fold' },
]

const BASE = {
  id: 'T1', parent_id: null as string | null, kind: 'task' as const, title: 't', stage: null,
  category: null, domain: null, assignee: null, schedule: null, depends: [] as string[],
  acceptance: [] as string[], priority: null, model: null, tags: [] as string[],
  prd_ref: null, entry_point: null, spec_sections: null,
}

describe('validateLevels — levels 선언 구조 검증(순수부)', () => {
  it('정상 7층 통과 — upload 기본 true, fold 는 최심층만', () => {
    const r = validateLevels(LEVELS)
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.levels).toHaveLength(7)
  })
  it('배열 아님·빈 배열 거부', () => {
    expect('error' in validateLevels(null)).toBe(true)
    expect('error' in validateLevels([])).toBe(true)
  })
  it('progress 허용 밖 값 거부', () => {
    expect('error' in validateLevels([{ name: 'Phase', prefix: 'PH', progress: 'percent' }])).toBe(true)
  })
  it('name·prefix 중복 거부', () => {
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup' },
      { name: 'Phase2', prefix: 'PH', progress: 'input' },
    ])).toBe(true)
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup' },
      { name: 'Phase', prefix: 'P2', progress: 'input' },
    ])).toBe(true)
  })
  it('input 층은 upload:true 강제 — false/fold 거부', () => {
    expect('error' in validateLevels([{ name: 'Task', prefix: 'TSK', progress: 'input', upload: false }])).toBe(true)
    expect('error' in validateLevels([{ name: 'Task', prefix: 'TSK', progress: 'input', upload: 'fold' }])).toBe(true)
  })
  it('upload 는 아래에서 위로만 — 위층 false 아래층 true 거부', () => {
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup' },
      { name: 'WP', prefix: 'WP', progress: 'rollup', upload: false },
      { name: 'Task', prefix: 'TSK', progress: 'input' },
    ])).toBe(true)
  })
  it('선두 연속 upload:false 는 골격층 선언 — 그 아래 true 허용 (PL 파일 정본 형태, E2E 2026-08-22 실측)', () => {
    const r = validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup', owner: 'pmo', upload: false },
      { name: 'System', prefix: 'SYS', progress: 'rollup', owner: 'pmo', upload: false },
      { name: 'Subsystem', prefix: 'SUB', progress: 'rollup' },
      { name: 'Task', prefix: 'TSK', progress: 'input' },
    ])
    expect('error' in r).toBe(false)
  })
  it('선두 fold 는 여전히 거부 — 접힐 부모가 없다', () => {
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup', upload: 'fold' },
      { name: 'Task', prefix: 'TSK', progress: 'input' },
    ])).toBe(true)
  })
  it('input 층 없는 선언 거부 — 발행 대상 층이 없으면 진도 입력 불가', () => {
    expect('error' in validateLevels([{ name: 'Phase', prefix: 'PH', progress: 'rollup' }])).toBe(true)
  })
})

describe('parseSchedule v2.2 — 종료일 단독 표기', () => {
  it('"~ 2026-11-14" → start:null, end 만 (nlevel wbs.md 의 ~날짜 토큰)', async () => {
    const { parseSchedule } = await import('@/lib/agent/wbsImport')
    expect(parseSchedule('~ 2026-11-14')).toEqual({ start: null, end: '2026-11-14' })
    expect(parseSchedule('~2026-11-14')).toEqual({ start: null, end: '2026-11-14' })
    // v2.0 양단 표기·오류 케이스는 종전 그대로
    expect(parseSchedule('2026-08-11 ~ 2026-08-14')).toEqual({ start: '2026-08-11', end: '2026-08-14' })
    expect('error' in parseSchedule('~11/14')).toBe(true)
  })
})

describe('toRpcNode v2.2 — levels 문맥의 노드 변환(순수부)', () => {
  it('level 인덱스 저장 + input 층 → dev_workflow:true, rollup 층 → false', () => {
    expect(toRpcNode('mes-op', { ...BASE, level: 5 }, 0, LEVELS))
      .toMatchObject({ level_idx: 5, dev_workflow: true })
    expect(toRpcNode('mes-op', { ...BASE, kind: 'wp' as const, level: 3 }, 0, LEVELS))
      .toMatchObject({ level_idx: 3, dev_workflow: false })
  })
  it('milestone 은 input 층이어도 dev_workflow:false — 발행 제외', () => {
    expect(toRpcNode('mes-op', { ...BASE, level: 5, milestone: true }, 0, LEVELS))
      .toMatchObject({ milestone: true, dev_workflow: false })
  })
  it('levels 있는데 level 누락·범위 밖 → 노드 단위 거부', () => {
    expect('error' in toRpcNode('mes-op', { ...BASE }, 0, LEVELS)).toBe(true)
    expect('error' in toRpcNode('mes-op', { ...BASE, level: 7 }, 0, LEVELS)).toBe(true)
    expect('error' in toRpcNode('mes-op', { ...BASE, level: -1 }, 0, LEVELS)).toBe(true)
  })
  it('weight 는 양수만 — 0·음수·NaN 거부, 생략은 null', () => {
    expect(toRpcNode('mes-op', { ...BASE, level: 5, weight: 5 }, 0, LEVELS)).toMatchObject({ weight: 5 })
    expect(toRpcNode('mes-op', { ...BASE, level: 5 }, 0, LEVELS)).toMatchObject({ weight: null })
    expect('error' in toRpcNode('mes-op', { ...BASE, level: 5, weight: 0 }, 0, LEVELS)).toBe(true)
    expect('error' in toRpcNode('mes-op', { ...BASE, level: 5, weight: -1 }, 0, LEVELS)).toBe(true)
  })
  it('credit → credit_key, if_id 패스스루', () => {
    expect(toRpcNode('mes-op', { ...BASE, level: 5, credit: 'if', if_id: 'IF-0031' }, 0, LEVELS))
      .toMatchObject({ credit_key: 'if', if_id: 'IF-0031' })
  })
  it('levels 없으면 v2.0 경로 불변 — kind 규칙 dev_workflow, level_idx:null', () => {
    const r = toRpcNode('MES', { ...BASE, kind: 'task' as const }, 0)
    expect(r).toMatchObject({ dev_workflow: true, level_idx: null, milestone: false, weight: null })
  })
})

// ─────────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as importPOST } from '@/app/api/v1/wbs/import/route'

type Resp = { data?: unknown; error?: { message: string; code?: string } | null }

/** wbs-import.test.ts 의 목과 동형 + upsert 기록(골격 levels 시드 검증용). */
function useAdmin(queues: Record<string, Resp[]>, rpcQueue: Resp[] = []) {
  const upserts: Record<string, unknown[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'delete', 'eq', 'in', 'limit']) b[k] = () => b
      b.upsert = (v: unknown) => { (upserts[table] ??= []).push(v); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => rpcQueue.shift() ?? { data: null, error: null }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'admin@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, upserts }
}

const PROJECT_ID = '87654321-4321-4321-4321-987654321def'

function patRow() {
  const { token, prefix, hash } = generateAgentToken()
  return {
    token,
    row: {
      id: 'runner-1', kind: 'user_pat' as const, owner_user_id: 'u-1',
      token_prefix: prefix, token_hash: hash, project_id: null,
      scopes: ['work:report'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
    },
  }
}

function post(body: unknown, bearer: string) {
  return new NextRequest('http://l/api/v1/wbs/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
}

/** 관리자 통과 공통 큐 — agent_runners·agent_projects·project_roles·memberships */
const authzQueues = () => ({
  agent_runners: [{ data: undefined as unknown }, { data: null }],
  agent_projects: [{ data: { enabled: true } }],
  project_roles: [{ data: [{ role: 'admin' }] }, { data: [{ role: 'admin' }] }],
  memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
})

const SERVER_LABELS = LEVELS.map(l => l.name)

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  delete process.env.AGENT_API_SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('POST /wbs/import — v2.2 nlevel', () => {
  it('PL 업로드: attach 해석 + levels 일치 → RPC 에 p_attach_id·level_idx 실림', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.agent_runners[0].data = row
    const { admin } = useAdmin({
      ...q,
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
      project_members: [{ data: [] }],
      wbs_items: [
        { data: { id: 'attach-1' } }, // attach_ref → 노드 해석
        { data: [{ id: 'id-t', external_ref: 'mes-op/TSK-OP-EV-PR-01', dev_workflow: true }] }, // 갭 후보
      ],
      agent_work_orders: [{ data: [{ wbs_item_id: 'id-t' }] }], // 활성 주문 있음 — 갭 없음
    }, [{ data: { upserted: 2, skipped: 0, ids: { 'mes-op/SUB-OP-EV': 'id-s', 'mes-op/TSK-OP-EV-PR-01': 'id-t' }, new_refs: [] } }])

    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'mes-op',
      levels: LEVELS, attach_ref: 'mes-skel/SYS-OP',
      nodes: [
        { ...BASE, id: 'SUB-OP-EV', kind: 'wp', title: '조업이벤트', level: 2 },
        { ...BASE, id: 'TSK-OP-EV-PR-01', parent_id: 'SUB-OP-EV', title: '수집 프로세스', level: 5, weight: 5, credit: 'default' },
      ],
    }, token))
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_upsert', expect.objectContaining({
      p_attach_id: 'attach-1',
      p_nodes: expect.arrayContaining([
        expect.objectContaining({ external_ref: 'mes-op/SUB-OP-EV', level_idx: 2, dev_workflow: false }),
        expect.objectContaining({ external_ref: 'mes-op/TSK-OP-EV-PR-01', level_idx: 5, weight: 5, credit_key: 'default', dev_workflow: true }),
      ]),
    }))
  })

  it('attach 노드 없음 → 400 attach_not_found (fail-closed, 골격 선행)', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.agent_runners[0].data = row
    useAdmin({
      ...q,
      project_settings: [{ data: { level_labels: SERVER_LABELS } }],
      wbs_items: [{ data: null }], // attach 해석 실패
    })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'mes-op', levels: LEVELS, attach_ref: 'mes-skel/SYS-XX',
      nodes: [{ ...BASE, id: 'SUB-1', level: 2 }],
    }, token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('attach_not_found')
  })

  it('levels 가 서버 정본과 불일치 → 400 levels_mismatch', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.agent_runners[0].data = row
    useAdmin({
      ...q,
      project_settings: [{ data: { level_labels: ['Phase', 'Task', 'Activity'] } }],
    })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'mes-op', levels: LEVELS, attach_ref: 'mes-skel/SYS-OP',
      nodes: [{ ...BASE, id: 'SUB-1', level: 2 }],
    }, token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('levels_mismatch')
  })

  it('attach_ref 있는데 levels 없음 → 400 (구조 검증, 인증 전)', async () => {
    const { token } = patRow()
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'mes-op', attach_ref: 'mes-skel/SYS-OP',
      nodes: [{ ...BASE, id: 'SUB-1' }],
    }, token))
    expect(res.status).toBe(400)
  })

  it('levels 구조 위반(progress 오타) → 400 (인증 전)', async () => {
    const { token } = patRow()
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'mes-op',
      levels: [{ name: 'Task', prefix: 'TSK', progress: 'percent' }],
      nodes: [{ ...BASE, id: 'T1', level: 0 }],
    }, token))
    expect(res.status).toBe(400)
  })

  it('골격 업로드(levels, attach 없음) → level_labels 를 project_settings 에 시드', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.agent_runners[0].data = row
    const { admin, upserts } = useAdmin({
      ...q,
      wbs_items: [{ data: [] }], // 트리 depth 조회 — 빈 트리
      project_members: [{ data: [] }],
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'mes-skel/PH-01': 'id-p' }, new_refs: [] } }])

    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'mes-skel', levels: LEVELS,
      nodes: [{ ...BASE, id: 'PH-01', kind: 'phase', title: '분석', level: 0 }],
    }, token))
    expect(res.status).toBe(200)
    expect(upserts.project_settings).toEqual([expect.objectContaining({
      project_id: PROJECT_ID, level_labels: SERVER_LABELS, max_depth: 7,
    })])
    // 골격 경로는 p_attach_id 를 싣지 않는다(레거시 RPC 와 인자 호환).
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_upsert',
      expect.not.objectContaining({ p_attach_id: expect.anything() }))
  })

  it('레거시 payload(levels 없음) → RPC 인자에 p_attach_id 없음 (v2.0 하위호환)', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.agent_runners[0].data = row
    const { admin } = useAdmin({
      ...q,
      project_members: [{ data: [] }],
      wbs_items: [{ data: [{ id: 'id-t', external_ref: 'MES/T1', dev_workflow: true }] }],
      agent_work_orders: [{ data: [{ wbs_item_id: 'id-t' }] }],
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'MES/T1': 'id-t' }, new_refs: [] } }])
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'MES', nodes: [{ ...BASE, id: 'T1' }],
    }, token))
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_upsert',
      expect.not.objectContaining({ p_attach_id: expect.anything() }))
  })
})
