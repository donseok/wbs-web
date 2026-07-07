import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · auth · admin 클라이언트를 모킹해 게이트 로직만 검증한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로, 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { getMembership } from '@/lib/auth'
import {
  createAccount, bulkCreateAccounts, resetPassword, updateAccountRole,
} from '@/app/actions/accounts'

const NON_ADMIN = [null, { role: 'team_editor', teamCode: 'PMO', teamId: 't1' }] as const

describe('계정 서버액션 권한 게이트', () => {
  beforeEach(() => { createAdminClient.mockClear() })

  it.each(NON_ADMIN)('비-pmo_admin(%o)은 createAccount 거부', async (membership) => {
    vi.mocked(getMembership).mockResolvedValue(membership as never)
    const res = await createAccount({ email: 'a@b.com', password: 'password1', teamCode: 'PMO', role: 'team_editor', name: null })
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비-pmo_admin은 bulkCreateAccounts 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    const res = await bulkCreateAccounts('a@b.com,PMO,team_editor,password1')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('권한 없음')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비-pmo_admin은 resetPassword 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    expect(await resetPassword('u1', 'password1')).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비-pmo_admin은 updateAccountRole 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    expect(await updateAccountRole('u1', 'PMO', 'team_editor')).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
