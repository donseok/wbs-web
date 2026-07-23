import { describe, it, expect, vi, beforeEach } from 'vitest'

// actions/minutes.ts 의 무거운 의존은 전부 목킹 — 이 테스트는 즐겨찾기 액션 2개의 배선만 본다.
const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...(a as [])),
  getMembership: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))

const getMinuteFavorites = vi.fn()
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), getMinutesTree: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: (...a: unknown[]) => getMinuteFavorites(...(a as [])),
}))

// thenable 가짜 빌더 — await sb.from(...).upsert(...) / .delete().eq().eq() 양쪽 체인 지원
type BuilderResult = { error: { message: string } | null }
function fakeClient(result: BuilderResult) {
  const calls: { upsert: unknown[][]; delete: number; eq: unknown[][] } = { upsert: [], delete: 0, eq: [] }
  const builder = {
    upsert: (...a: unknown[]) => { calls.upsert.push(a); return builder },
    delete: () => { calls.delete += 1; return builder },
    eq: (...a: unknown[]) => { calls.eq.push(a); return builder },
    then: (resolve: (v: BuilderResult) => void) => resolve(result),
  }
  return { client: { from: vi.fn(() => builder) }, calls }
}
const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import { fetchMinuteFavorites, toggleMinuteFavorite } from '@/app/actions/minutes'

beforeEach(() => {
  getSession.mockReset(); getMinuteFavorites.mockReset(); createServerClient.mockReset()
})

describe('fetchMinuteFavorites', () => {
  it('미로그인은 데이터 계층을 부르지 않고 null', async () => {
    getSession.mockResolvedValue(null)
    expect(await fetchMinuteFavorites()).toBeNull()
    expect(getMinuteFavorites).not.toHaveBeenCalled()
  })
  it('로그인 시 데이터 계층 결과를 그대로 반환', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    getMinuteFavorites.mockResolvedValue(['m1', 'm2'])
    expect(await fetchMinuteFavorites()).toEqual(['m1', 'm2'])
  })
})

describe('toggleMinuteFavorite', () => {
  it('미로그인은 false + 클라이언트 미생성', async () => {
    getSession.mockResolvedValue(null)
    expect(await toggleMinuteFavorite('m1', true)).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('on=true 는 (user_id, minute_id) upsert(중복 무시)', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    const { client, calls } = fakeClient({ error: null })
    createServerClient.mockResolvedValue(client)
    expect(await toggleMinuteFavorite('m1', true)).toBe(true)
    expect(calls.upsert[0]).toEqual([
      { user_id: 'u1', minute_id: 'm1' },
      { onConflict: 'user_id,minute_id', ignoreDuplicates: true },
    ])
  })
  it('on=false 는 본인 행 delete', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    const { client, calls } = fakeClient({ error: null })
    createServerClient.mockResolvedValue(client)
    expect(await toggleMinuteFavorite('m1', false)).toBe(true)
    expect(calls.delete).toBe(1)
    expect(calls.eq).toEqual([[ 'user_id', 'u1' ], [ 'minute_id', 'm1' ]])
  })
  it('DB 에러는 false(호출부가 롤백+토스트)', async () => {
    getSession.mockResolvedValue({ id: 'u1' })
    const { client } = fakeClient({ error: { message: 'boom' } })
    createServerClient.mockResolvedValue(client)
    expect(await toggleMinuteFavorite('m1', true)).toBe(false)
  })
})
