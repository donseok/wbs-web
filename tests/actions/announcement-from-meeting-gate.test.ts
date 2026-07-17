import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerClient 는 게이트 통과 전에 호출되면 안 된다.
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('게이트 통과 전 createServerClient 호출 금지')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/announcements', () => ({ getTopAnnouncements: vi.fn() }))

import { getMembership } from '@/lib/auth'
import { createAnnouncementFromMeeting } from '@/app/actions/announcements'

const NON_ADMIN = [null, { role: 'team_editor', teamCode: 'PMO', teamId: 't1' }] as const

describe('createAnnouncementFromMeeting 권한 게이트', () => {
  beforeEach(() => { createServerClient.mockClear() })

  it.each(NON_ADMIN)('비-pmo_admin(%o)은 거부하고 DB에 손대지 않는다', async (membership) => {
    vi.mocked(getMembership).mockResolvedValue(membership as never)
    const res = await createAnnouncementFromMeeting('m1', '2026-07-20')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('권한 없음')
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
