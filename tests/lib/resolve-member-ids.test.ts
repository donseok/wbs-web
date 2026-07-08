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
const FAIL: Reply = { data: null, error: { message: 'column "user_id" does not exist' } }
const sorted = (a: string[]) => [...a].sort()

describe('resolveMemberIds — 로그인 계정 ↔ project_members 연결', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('user_id 와 email 결과의 합집합을 낸다 — 프로젝트마다 연결 방식이 달라도 놓치지 않는다', async () => {
    // 프로젝트 A 행은 user_id 로, 프로젝트 B 행은 email 로만 이어진 상태.
    const { sb } = stub({ 'user_id=u1': OK(['mA']), 'email=a@b.com': OK(['mB']) })
    expect(sorted(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' }))).toEqual(['mA', 'mB'])
  })

  it('양쪽이 같은 행을 가리키면 중복 없이 한 번만 낸다', async () => {
    const { sb } = stub({ 'user_id=u1': OK(['m1']), 'email=a@b.com': OK(['m1']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual(['m1'])
  })

  it('email 조회는 소문자로 정규화한다 — 0019 이후 email 은 소문자로 저장된다', async () => {
    const { sb, calls } = stub({ 'email=a@b.com': OK(['m9']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: '  A@B.CoM ' })).toEqual(['m9'])
    expect(calls).toContainEqual(['email', 'a@b.com'])
  })

  it('이메일 없는 계정은 user_id 만 본다', async () => {
    const { sb, calls } = stub({ 'user_id=u1': OK(['m1']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: null })).toEqual(['m1'])
    expect(calls).toEqual([['user_id', 'u1']])
  })

  it('user_id 조회가 실패해도 email 결과로 계속 동작한다 — 마이그레이션 전 배포 내성', async () => {
    const { sb } = stub({ 'user_id=u1': FAIL, 'email=a@b.com': OK(['m9']) })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual(['m9'])
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('email 조회가 실패해도 user_id 결과로 계속 동작한다', async () => {
    const { sb } = stub({ 'user_id=u1': OK(['m1']), 'email=a@b.com': FAIL })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual(['m1'])
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('둘 다 실패하면 빈 배열 + 두 번 로그 — 무매칭과 조용히 섞이지 않는다', async () => {
    const { sb } = stub({ 'user_id=u1': FAIL, 'email=a@b.com': FAIL })
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual([])
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('둘 다 무매칭이면 빈 배열이고 로그는 남기지 않는다', async () => {
    const { sb } = stub({})
    expect(await resolveMemberIds(sb, { id: 'u1', email: 'a@b.com' })).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
  })
})
