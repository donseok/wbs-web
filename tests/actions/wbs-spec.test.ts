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

import { getWbsSpec, updateAgentPrompt, updateWbsSpec, updateWbsSpecFields } from '@/app/actions/wbsSpec'
import { SPEC_UPDATED_TOKEN } from '@/lib/domain/wbsSpecLog'

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
  // itemId → project_id 해석은 RLS 스코프(resolveProjectId)로만 한다 — admin 클라이언트로
  // 먼저 존재를 확인하면 비멤버가 "존재하지만 권한 없음"과 "존재 자체가 없음"을 구분할 수 있다
  // (존재 오라클, 리뷰 라운드 1). updateWbsSpec/updateWbsSpecFields 는 admin 클라이언트를
  // 실제 update·insert 에만 쓴다.
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
})

describe('updateWbsSpec', () => {
  it('관리자 → spec 갱신 + change_logs(field: spec, 로케일 중립 토큰) 기록', async () => {
    const { captured } = admin({
      wbs_items: [{ data: [{ id: W1 }] }],
      change_logs: [{ data: [{ id: 'log1' }] }],
    })
    const r = await updateWbsSpec(W1, '# 새 명세')
    expect(r.ok).toBe(true)
    expect(mocks.resolveProjectId).toHaveBeenCalledWith('wbs_items', W1)
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(captured.wbs_items[0]).toMatchObject({ spec: '# 새 명세' })
    // 로그값은 본문 전문도, 한국어 리터럴도 아니다 — 로케일 중립 토큰만(리뷰 라운드 1).
    expect(captured.change_logs[0]).toMatchObject({ field: 'spec', new_value: SPEC_UPDATED_TOKEN })
    expect(captured.change_logs[0]).not.toMatchObject({ new_value: '# 새 명세' })
  })

  it('관리자 아님 → 거부, DB 쓰기 큐 소비 0', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { captured } = admin({})
    const r = await updateWbsSpec(W1, '# 새 명세')
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.wbs_items ?? []).toHaveLength(0)
    expect(captured.change_logs ?? []).toHaveLength(0)
  })

  it('resolveProjectId 가 대상을 찾지 못하면(비멤버에게 안 보이는 항목 포함 동일 응답) 거부 — admin 판정 전에 중단, 존재 오라클 없음', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const { captured } = admin({})
    const r = await updateWbsSpec(W1, '# 새 명세')
    expect(r).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('1MB 초과 spec 거부(상한)', async () => {
    const { captured, calls } = admin({})
    const r = await updateWbsSpec(W1, 'a'.repeat(1_048_577))
    expect(r).toEqual({ ok: false, error: '명세가 너무 큽니다(1MB 상한).' })
    expect(calls).toHaveLength(0)
    expect(mocks.resolveProjectId).not.toHaveBeenCalled()
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('spec 이 문자열이 아니면 거부(런타임 방어)', async () => {
    const { calls } = admin({})
    const r = await updateWbsSpec(W1, 42 as unknown as string)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
    expect(mocks.resolveProjectId).not.toHaveBeenCalled()
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
      wbs_items: [{ data: [{ id: W1 }] }],
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
    const { captured } = admin({})
    const r = await updateWbsSpecFields(W1, { priority: 'high' })
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('resolveProjectId 가 대상을 찾지 못하면 거부 — admin 판정 전에 중단, 존재 오라클 없음', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const { captured } = admin({})
    const r = await updateWbsSpecFields(W1, { priority: 'high' })
    expect(r).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })
})

describe('updateAgentPrompt', () => {
  it('관리자 → agent_prompt 갱신(trim), 이력은 남기지 않는다(본문성 필드 — spec 과 달리 토큰 로그도 없음)', async () => {
    const { captured } = admin({ wbs_items: [{ data: [{ id: W1 }] }] })
    const r = await updateAgentPrompt(W1, '  기존 API 계약을 깨지 말 것  ')
    expect(r.ok).toBe(true)
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(captured.wbs_items[0]).toMatchObject({ agent_prompt: '기존 API 계약을 깨지 말 것' })
  })

  it('빈 문자열(공백만)은 null 로 저장 — 지운다', async () => {
    const { captured } = admin({ wbs_items: [{ data: [{ id: W1 }] }] })
    const r = await updateAgentPrompt(W1, '   ')
    expect(r.ok).toBe(true)
    expect(captured.wbs_items[0]).toMatchObject({ agent_prompt: null })
  })

  it('관리자 아님 → 거부, 쓰기 0', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const { captured } = admin({})
    const r = await updateAgentPrompt(W1, '프롬프트')
    expect(r).toEqual({ ok: false, error: '권한 없음' })
    expect(captured.wbs_items ?? []).toHaveLength(0)
  })

  it('16KB 초과 거부 — 프롬프트는 지시문이지 문서 저장소가 아니다', async () => {
    const { calls } = admin({})
    const r = await updateAgentPrompt(W1, 'a'.repeat(16_385))
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
    expect(mocks.resolveProjectId).not.toHaveBeenCalled()
  })

  it('문자열 아님·잘못된 itemId → 거부', async () => {
    const { calls } = admin({})
    expect((await updateAgentPrompt(W1, 42 as unknown as string)).ok).toBe(false)
    expect((await updateAgentPrompt('nope', '프롬프트')).ok).toBe(false)
    expect(calls).toHaveLength(0)
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
                external_ref: 'mod/TSK-01-01', agent_prompt: '레거시 호환 유지할 것',
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
      externalRef: 'mod/TSK-01-01', agentPrompt: '레거시 호환 유지할 것',
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
