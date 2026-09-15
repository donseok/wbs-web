// 크레딧 표 저장 액션(스펙 2026-09-15 §3.3·§5.1) — 관리자 가드·검증 거부·upsert(소급 없음).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(), getActorViewState: vi.fn(),
  createAdminClient: vi.fn(), createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin, requireSuperuser: mocks.requireSuperuser, getActorViewState: mocks.getActorViewState,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { updateStageCredits } from '@/app/actions/project'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const P1 = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
})

describe('updateStageCredits', () => {
  it('관리자가 아니면 그 가드 문구로 거부하고 DB 에 접근하지 않는다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateStageCredits(P1, DEFAULT_STAGE_CREDITS)).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('검증 실패(간격 10 미만)는 저장하지 않는다', async () => {
    const r = await updateStageCredits(P1, { default: { as: 0, ip: 30, rw: 35, im: 80, xx: 100 } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('간격')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('유효하면 project_settings.stage_credits 를 upsert 한다 — 실적은 건드리지 않는다(소급 없음)', async () => {
    const tables: string[] = []
    const upsert = vi.fn(async () => ({ error: null }))
    mocks.createAdminClient.mockReturnValue({ from: (t: string) => { tables.push(t); return { upsert } } })
    expect(await updateStageCredits(P1, DEFAULT_STAGE_CREDITS)).toEqual({ ok: true })
    expect(tables).toEqual(['project_settings'])
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ project_id: P1, stage_credits: DEFAULT_STAGE_CREDITS, updated_by: 'admin-1' }))
  })
  it('저장 오류는 그 문구 그대로', async () => {
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert: async () => ({ error: { message: 'db down' } }) }) })
    expect(await updateStageCredits(P1, DEFAULT_STAGE_CREDITS)).toEqual({ ok: false, error: 'db down' })
  })
})
