import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
  resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getWbsSpec, updateWbsSpec, updateWbsSpecFields } from '@/app/actions/wbsSpec'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 큐 기반 admin 목 — 테이블별 순차 응답 + insert/update payload 캡처 + 호출된 테이블 목록. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const calls: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
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
})

describe('updateWbsSpec', () => {
  it('관리자 → spec 갱신 + change_logs(field: spec) 기록', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1 } },
        { data: [{ id: W1 }] },
      ],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await updateWbsSpec(W1, '# 새 명세')
    expect(r.ok).toBe(true)
    expect(captured.wbs_items[0]).toMatchObject({ spec: '# 새 명세' })
    expect(captured.change_logs[0]).toMatchObject({ field: 'spec' })
  })

  it('관리자 아님 → 거부, DB 쓰기 큐 소비 0', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { captured } = admin({
      wbs_items: [{ data: { id: W1, project_id: P1 } }],
    })
    const r = await updateWbsSpec(W1, '# 새 명세')
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(captured.change_logs ?? []).toHaveLength(0)
  })

  it('1MB 초과 spec 거부(상한)', async () => {
    const { captured, calls } = admin({})
    const r = await updateWbsSpec(W1, 'a'.repeat(1_048_577))
    expect(r).toEqual({ ok: false, error: '명세가 너무 큽니다(1MB 상한).' })
    expect(calls).toHaveLength(0)
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('잘못된 itemId → 거부', async () => {
    const { calls } = admin({})
    const r = await updateWbsSpec('not-a-uuid', '# 명세')
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('updateWbsSpecFields', () => {
  it('priority 허용 밖 라벨 거부', async () => {
    const { calls } = admin({})
    const r = await updateWbsSpecFields(W1, { priority: 'urgent' as never })
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('prd_ref·entry_point 부분 갱신 — 전달된 키만 update payload 에 포함', async () => {
    const { captured } = admin({
      wbs_items: [
        { data: { id: W1, project_id: P1 } },
        { data: [{ id: W1 }] },
      ],
    })
    const r = await updateWbsSpecFields(W1, { prd_ref: 'docs/prd.md#3' })
    expect(r.ok).toBe(true)
    expect(captured.wbs_items[0]).toMatchObject({ prd_ref: 'docs/prd.md#3' })
    expect(captured.wbs_items[0]).not.toHaveProperty('entry_point')
    expect(captured.wbs_items[0]).not.toHaveProperty('priority')
  })

  it('갱신할 필드가 없으면 거부', async () => {
    const { calls } = admin({})
    const r = await updateWbsSpecFields(W1, {})
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('관리자 아님 → 거부, DB 쓰기 큐 소비 0', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { captured } = admin({
      wbs_items: [{ data: { id: W1, project_id: P1 } }],
    })
    const r = await updateWbsSpecFields(W1, { priority: 'high' })
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })
})

describe('getWbsSpec', () => {
  it('같은 프로젝트 멤버 + 조회 성공 → 현재 값 반환', async () => {
    mocks.createServerClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                category: 'dev', domain: 'fullstack', priority: 'high', model: 'opus',
                tags: ['contract'], depends: ['TSK-01-00'], prd_ref: 'docs/prd.md#3',
                entry_point: 'src/x.tsx', acceptance: ['목록이 뜬다'], spec: '# 명세',
                external_ref: 'mod/TSK-01-01',
              },
              error: null,
            }),
          }),
        }),
      }),
    })
    const r = await getWbsSpec(W1)
    expect(mocks.resolveProjectId).toHaveBeenCalledWith('wbs_items', W1)
    expect(mocks.requireProjectMember).toHaveBeenCalledWith(P1)
    expect(r).toEqual({
      category: 'dev', domain: 'fullstack', priority: 'high', model: 'opus',
      tags: ['contract'], depends: ['TSK-01-00'], prdRef: 'docs/prd.md#3',
      entryPoint: 'src/x.tsx', acceptance: ['목록이 뜬다'], spec: '# 명세',
      externalRef: 'mod/TSK-01-01',
    })
  })

  it('이 프로젝트 멤버가 아니면 거부 → null(조회 자체를 하지 않는다)', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const r = await getWbsSpec(W1)
    expect(r).toBeNull()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('소속 프로젝트 조회 실패 → null(명세 없음으로 위장하지 않는다)', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const r = await getWbsSpec(W1)
    expect(r).toBeNull()
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })
})
