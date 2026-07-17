import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('인증 게이트 전에 DB 클라이언트를 만들면 안 됩니다.')
  }),
  generate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/ai/minutes-commitments-generator', () => ({
  generateMinuteCommitments: mocks.generate,
}))

import { getMembership, getSession } from '@/lib/auth'
import {
  extractMinuteCommitmentsAction,
  reviewMinuteCommitmentAction,
} from '@/app/actions/minute-commitments'

describe('회의록 약속 액션 인증 게이트', () => {
  beforeEach(() => {
    vi.mocked(getMembership).mockReset()
    vi.mocked(getSession).mockReset()
    mocks.createServerClient.mockClear()
    mocks.generate.mockClear()
  })

  it('멤버십이 없으면 추출 전에 DB와 LLM을 차단한다', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue({ id: 'u1' } as never)

    expect(await extractMinuteCommitmentsAction('m1')).toEqual({ ok: false, error: '로그인 필요' })
    expect(mocks.createServerClient).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('세션이 없으면 검토 전에 DB를 차단한다', async () => {
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin' } as never)
    vi.mocked(getSession).mockResolvedValue(null)

    const result = await reviewMinuteCommitmentAction({ commitmentId: 'c1', status: 'confirmed' })
    expect(result).toEqual({ ok: false, error: '로그인 필요' })
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})
