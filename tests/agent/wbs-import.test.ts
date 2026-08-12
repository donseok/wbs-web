import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import {
  parseSchedule, toRpcNode, assembleSpecMarkdown,
} from '@/lib/agent/wbsImport'

describe('wbsImport 변환(순수부)', () => {
  it('schedule 문자열 분해', () => {
    expect(parseSchedule('2026-08-11 ~ 2026-08-14')).toEqual({ start: '2026-08-11', end: '2026-08-14' })
    expect(parseSchedule(null)).toEqual({ start: null, end: null })
    expect('error' in parseSchedule('8/11~8/14')).toBe(true)
  })
  it('external_ref 합성 — module + "/" + id, parent·depends 도 동일 규칙', () => {
    const base = { id: 'TSK-01-01', parent_id: 'WP-01', kind: 'task' as const, title: '조회 화면', stage: null, category: 'dev', domain: 'fullstack', assignee: 'A@B.c', schedule: null, depends: ['TSK-01-00'], acceptance: ['목록이 뜬다'], priority: 'high' as const, model: 'opus', tags: ['contract'], prd_ref: 'docs/prd.md#3', entry_point: 'src/x.tsx', spec_sections: null }
    const r = toRpcNode('MES', base, 7)
    expect(r).toMatchObject({
      external_ref: 'MES/TSK-01-01', parent_external_ref: 'MES/WP-01',
      depends: ['MES/TSK-01-00'], sort_order: 7, assignee: 'a@b.c',
      priority: 'high', acceptance: ['목록이 뜬다'],
    })
  })
  it('stage·priority 허용 밖 값은 노드 단위 거부', () => {
    const n = { id: 'T1', parent_id: null, kind: 'task' as const, title: 't', stage: null, category: null, domain: null, assignee: null, schedule: null, depends: [], acceptance: [], priority: null, model: null, tags: [], prd_ref: null, entry_point: null, spec_sections: null }
    expect('error' in toRpcNode('MES', { ...n, stage: 'dd' }, 0)).toBe(true)
    expect('error' in toRpcNode('MES', { ...n, priority: 'urgent' as never }, 0)).toBe(true)
  })
  it('spec_sections → 고정 섹션 순서 마크다운 조립(결정 E)', () => {
    const md = assembleSpecMarkdown({
      requirements: ['R1'], test_criteria: ['T1'], constraints: ['C1'],
      api_spec: 'GET /x', data_model: 'wbs_items(...)', description: '개요.',
    })
    expect(md).toBe('개요.\n\n## 요구사항\n- R1\n\n## 제약\n- C1\n\n## 테스트 기준\n- T1\n\n## API 스펙\nGET /x\n\n## 데이터 모델\nwbs_items(...)')
    expect(assembleSpecMarkdown(null)).toBeNull()
    expect(assembleSpecMarkdown({ requirements: [], test_criteria: [], constraints: [], api_spec: null, data_model: null, description: null })).toBeNull()
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

/**
 * 테이블별 큐 + rpc 큐를 갖는 admin 목.
 * .from(table) 호출 시 큐 선두를 소비 — select/maybeSingle/single/then(암묵 await) 모두 같은 응답을 본다.
 */
function useAdmin(queues: Record<string, Resp[]>, rpcQueue: Resp[] = [], users: Array<{ id: string; email: string }> = [{ id: 'u-1', email: 'admin@example.com' }]) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'delete', 'eq', 'in', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => rpcQueue.shift() ?? { data: null, error: null }),
    auth: { admin: { getUserById: vi.fn(async (id: string) => {
      const u = users.find(x => x.id === id) ?? users[0]
      return { data: { user: u }, error: null }
    }) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const PROJECT_ID = '87654321-4321-4321-4321-987654321def'
const OWNER = { id: 'u-1', email: 'admin@example.com' }

function patRow(overrides: Partial<{ scopes: string[]; project_id: string | null; enabled: boolean; revoked_at: string | null; expires_at: string }> = {}) {
  const { token, prefix, hash } = generateAgentToken()
  const row = {
    id: 'runner-1', kind: 'user_pat' as const, owner_user_id: OWNER.id,
    token_prefix: prefix, token_hash: hash, project_id: overrides.project_id ?? null,
    scopes: overrides.scopes ?? ['work:report'], enabled: overrides.enabled ?? true,
    revoked_at: overrides.revoked_at ?? null, expires_at: overrides.expires_at ?? '2099-01-01T00:00:00Z',
  }
  return { token, row }
}

function post(body: unknown, bearer: string) {
  return new NextRequest('http://l/api/v1/wbs/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
}

const NODE = (over: Partial<{ id: string; parent_id: string | null; kind: 'phase' | 'act' | 'wp' | 'task'; assignee: string | null }>) => ({
  id: over.id ?? 'T1', parent_id: over.parent_id ?? null, kind: over.kind ?? 'task',
  title: `제목 ${over.id ?? 'T1'}`, stage: null, category: 'dev', domain: 'fullstack',
  assignee: over.assignee ?? null, schedule: null, depends: [], acceptance: ['수용기준'],
  priority: 'high', model: null, tags: [], prd_ref: null, entry_point: null, spec_sections: null,
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  delete process.env.AGENT_API_SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('POST /wbs/import', () => {
  it('PAT + work:report + 관리자 → RPC 호출 + 신규 리프 배정 매칭 + orders_created 집계', async () => {
    const { token, row } = patRow()
    const body = {
      project_id: PROJECT_ID, module: 'MES',
      nodes: [NODE({ id: 'WP-01', kind: 'wp' }), NODE({ id: 'T-A', parent_id: 'WP-01', assignee: 'a@b.c' }), NODE({ id: 'T-B', parent_id: 'WP-01' })],
    }
    useAdmin({
      agent_runners: [{ data: row }, { data: null }], // 리졸버 select, last_seen_at 갱신
      agent_projects: [{ data: { enabled: true } }, { data: { enabled: true } }], // 라우트 게이트, ensureOrder 게이트
      // memberships·project_roles 는 각 2회 조회된다: isAgentProjectMember(비멤버 404 게이트) → 관리자 판정.
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [{ role: 'admin' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_members: [{ data: [{ id: 'member-1', email: 'a@b.c' }] }],
      wbs_items: [
        { data: null }, // assignee_member_id update
        { data: null }, // ensureOrder: 자식 없음(리프)
        { data: { name: '제목 T-A', priority: 'high', external_ref: 'MES/T-A', assignee_member_id: 'member-1' } }, // ensureOrder: 항목 조회
      ],
      agent_work_orders: [
        { data: null }, // 활성 주문 없음
        { data: { id: 'order-1' } }, // insert
      ],
    }, [{ data: { upserted: 3, skipped: 0, ids: { 'MES/WP-01': 'id-wp', 'MES/T-A': 'id-a', 'MES/T-B': 'id-b' }, new_refs: ['MES/T-A'] } }])

    const res = await importPOST(post(body, token))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true, upserted: 3, skipped: 0, unmatched_assignees: [], non_leaf_skipped: [], orders_created: 1,
    })

    // work.assigned — 담당자 매칭 알림, 재업로드 멱등 dedupeKey
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.assigned',
      recipientMemberIds: ['member-1'],
      dedupeKey: 'assigned:MES/T-A:member-1',
    }))
    // system.import_result — 실행자 통지
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system.import_result',
      recipientUserIds: [OWNER.id],
      payload: expect.objectContaining({ detail: 'upserted 3건, 담당자 미매칭 0건' }),
    }))
  })

  it('assignee 미매칭은 생략하지 않고 unmatched_assignees 전량 리포트(에러 3원칙)', async () => {
    const { token, row } = patRow()
    const body = {
      project_id: PROJECT_ID, module: 'MES',
      nodes: [NODE({ id: 'T-A', assignee: 'a@b.c' })],
    }
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [{ role: 'admin' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_members: [{ data: [{ id: 'member-x', email: 'other@example.com' }] }], // 다른 email 만
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'MES/T-A': 'id-a' }, new_refs: ['MES/T-A'] } }])

    const res = await importPOST(post(body, token))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.unmatched_assignees).toEqual([{ id: 'T-A', assignee: 'a@b.c' }])
    expect(json.orders_created).toBe(0)
    // 매칭 실패 항목엔 work.assigned 미발행
    expect(mocks.emitNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'work.assigned' }))
  })

  it('일반 멤버(role=member) PAT → 403 forbidden_role (멤버는 맞지만 관리자가 아님)', async () => {
    const { token, row } = patRow()
    const body = { project_id: PROJECT_ID, module: 'MES', nodes: [NODE({ id: 'T-A' })] }
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      // memberships·project_roles 2회: isAgentProjectMember(멤버 확인, role 존재→통과) → 관리자 판정(role≠admin→403).
      project_roles: [{ data: [{ role: 'member' }] }, { data: [{ role: 'member' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
    })
    const res = await importPOST(post(body, token))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
  })

  it('완전 비멤버 PAT → 404 (존재 은닉 — 관리자 판정보다 먼저 걸린다)', async () => {
    const { token, row } = patRow()
    const body = { project_id: PROJECT_ID, module: 'MES', nodes: [NODE({ id: 'T-A' })] }
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      // isAgentProjectMember 에서만 소비 — role 행이 없으므로 여기서 404, 관리자 판정 코드까지 가지 않는다.
      project_roles: [{ data: [] }],
      memberships: [{ data: { is_superuser: false } }],
    })
    const res = await importPOST(post(body, token))
    expect(res.status).toBe(404)
  })

  it('legacy 호출 → 400 identity_required', async () => {
    process.env.AGENT_API_SECRET = 'legacy-secret'
    const body = { project_id: PROJECT_ID, module: 'MES', nodes: [NODE({ id: 'T-A' })] }
    useAdmin({})
    const res = await importPOST(post(body, 'legacy-secret'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })

  it('nodes 1000건 초과 → 400', async () => {
    const { token } = patRow()
    const body = {
      project_id: PROJECT_ID, module: 'MES',
      nodes: Array.from({ length: 1001 }, (_, i) => NODE({ id: `T-${i}` })),
    }
    // 리졸버 큐 소비 전에 400 이어야 하므로 admin 목은 비워둔다(호출되면 큐 미스로 표면화).
    const res = await importPOST(post(body, token))
    expect(res.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('재업로드 멱등 — new_refs 없으면 매칭·발행·알림 재실행 0건', async () => {
    const { token, row } = patRow()
    const body = {
      project_id: PROJECT_ID, module: 'MES',
      nodes: [NODE({ id: 'T-A', assignee: 'a@b.c' })],
    }
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [{ role: 'admin' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_members: [{ data: [{ id: 'member-1', email: 'a@b.c' }] }],
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'MES/T-A': 'id-a' }, new_refs: [] } }]) // 이미 존재 — 신규 없음

    const res = await importPOST(post(body, token))
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, unmatched_assignees: [], orders_created: 0 })
    expect(mocks.emitNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'work.assigned' }))
  })

  it('non_leaf_skipped 도 bare id — unmatched_assignees 와 동일 규칙', async () => {
    const { token, row } = patRow()
    const body = {
      project_id: PROJECT_ID, module: 'MES',
      nodes: [NODE({ id: 'WP-01', kind: 'wp', assignee: 'a@b.c' })],
    }
    useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }, { data: { enabled: true } }], // 라우트 게이트, ensureOrder 게이트
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [{ role: 'admin' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_members: [{ data: [{ id: 'member-1', email: 'a@b.c' }] }],
      wbs_items: [
        { data: null }, // assignee_member_id update
        { data: { id: 'child-x' } }, // ensureOrder: 자식 있음 — 리프 아님
      ],
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'MES/WP-01': 'id-wp' }, new_refs: ['MES/WP-01'] } }])

    const res = await importPOST(post(body, token))
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, non_leaf_skipped: ['WP-01'], orders_created: 0 })
  })
})
