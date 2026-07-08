import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { resolveMemberIds } from '@/lib/data/meetings'

type Reply = { data: { id: string }[] | null; error: { message: string } | null }

/** eq(col, val) 호출을 기록하는 최소 supabase 스텁. */
function stub(replies: Record<string, Reply>) {
  const calls: Array<[string, string]> = []
  const sb = {
    from: () => ({
      select: () => ({
        eq: (col: string, val: string): Promise<Reply> => {
          calls.push([col, val])
          return Promise.resolve(replies[`${col}=${val}`] ?? { data: [], error: null })
        },
      }),
    }),
  }
  return { sb: sb as never, calls }
}

const OK = (ids: string[]): Reply => ({ data: ids.map((id) => ({ id })), error: null })
const FAIL: Reply = { data: null, error: { message: 'permission denied' } }

describe('resolveMemberIds — 로그인 계정 ↔ project_members 연결', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('user_id 로 연결된 행이 있으면 그것을 쓰고 email 은 조회하지 않는다', async () => {
    const { sb, calls } = stub({ 'user_id=u1': OK(['m1', 'm2']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual(['m1', 'm2'])
    expect(calls).toEqual([['user_id', 'u1']])
  })

  it('user_id 무매칭이면 email 로 폴백한다 (미연결 행 / 개인 이메일 로그인)', async () => {
    const { sb, calls } = stub({ 'email=a@b.com': OK(['m9']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual(['m9'])
    expect(calls).toEqual([['user_id', 'u1'], ['email', 'a@b.com']])
  })

  it('폴백 조회는 소문자로 정규화한다 — 0019 이후 email 은 소문자로 저장된다', async () => {
    const { sb, calls } = stub({ 'email=a@b.com': OK(['m9']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: '  A@B.CoM ' })).toEqual(['m9'])
    expect(calls[1]).toEqual(['email', 'a@b.com'])
  })

  it('이메일 없는 계정은 user_id 만 본다', async () => {
    const { sb, calls } = stub({})
    expect(await resolveMemberIds(sb, { id: 'u1', email: null })).toEqual([])
    expect(calls).toEqual([['user_id', 'u1']])
  })

  it('user_id 조회가 실패하면 빈 배열 + 로그 — 무매칭과 조용히 섞이지 않는다', async () => {
    const { sb } = stub({ 'user_id=u1': FAIL })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual([])
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('email 폴백 조회가 실패해도 빈 배열 + 로그', async () => {
    const { sb } = stub({ 'email=a@b.com': FAIL })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual([])
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('둘 다 무매칭이면 빈 배열이고 로그는 남기지 않는다', async () => {
    const { sb } = stub({})
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
  })
})
