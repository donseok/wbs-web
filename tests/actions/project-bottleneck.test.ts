// 병목 제안 기준 저장(강제 진행 스펙 F14) — 관리자 가드·검증 거부·두 컬럼 upsert.
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

import { updateBottleneckSettings } from '@/app/actions/project'

const P1 = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
})

describe('updateBottleneckSettings', () => {
  it('관리자가 아니면 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateBottleneckSettings(P1, { minSuccessors: 3, minHours: 4 })).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('검증 실패는 저장하지 않는다', async () => {
    const r = await updateBottleneckSettings(P1, { minSuccessors: 0, minHours: 4 })
    expect(r.ok).toBe(false)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('두 컬럼을 upsert 한다', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert }) })
    expect(await updateBottleneckSettings(P1, { minSuccessors: 5, minHours: 8 })).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ project_id: P1, force_bottleneck_min_successors: 5, force_bottleneck_min_hours: 8, updated_by: 'admin-1' }))
  })
})
