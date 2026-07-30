import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerClient 는 게이트 통과 전에 호출되면 안 된다.
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('게이트 통과 전 createServerClient 호출 금지')
  }),
}))
const { requireProjectAdmin, resolveProjectId } = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/announcements', () => ({ getTopAnnouncements: vi.fn() }))

import { createAnnouncementFromMeeting } from '@/app/actions/announcements'

/** 가드가 돌려주는 두 거부 사유 — 비로그인과 권한 부족을 같은 문구로 뭉개지 않는다. */
const DENIALS = ['로그인 필요', '권한 없음'] as const

describe('createAnnouncementFromMeeting 권한 게이트', () => {
  beforeEach(() => {
    createServerClient.mockClear()
    requireProjectAdmin.mockReset()
    resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  })

  it.each(DENIALS)('회의가 속한 프로젝트의 관리자가 아니면 거부한다(%s)', async (error) => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error })
    const res = await createAnnouncementFromMeeting('m1', '2026-07-20')
    expect(res).toEqual({ ok: false, error })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('회의 행에서 프로젝트를 읽지 못하면 권한 판정 전에 중단한다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const res = await createAnnouncementFromMeeting('m1', '2026-07-20')
    expect(res).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
