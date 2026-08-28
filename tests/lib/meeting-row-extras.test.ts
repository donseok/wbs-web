import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { getMeetingRowExtras } from '@/lib/data/meetings'

type Reply = { data: unknown[] | null; error: { message: string } | null }
const OK = (rows: unknown[]): Reply => ({ data: rows, error: null })
const ERR = (message: string): Reply => ({ data: null, error: { message } })

function makeSb(opts: { meetings?: Reply; members?: Reply }) {
  const calls: { table: string; select: string; inArgs: unknown[] }[] = []
  const sb = {
    from: (table: string) => ({
      select: (select: string) => {
        const call = { table, select, inArgs: [] as unknown[] }
        calls.push(call)
        const o: Record<string, unknown> = {}
        o.in = (_col: string, ids: unknown[]) => { call.inArgs = ids; return o }
        o.then = (res: unknown, rej: unknown) => {
          const reply = table === 'meetings' ? (opts.meetings ?? OK([])) : (opts.members ?? OK([]))
          return Promise.resolve(reply).then(res as never, rej as never)
        }
        return o
      },
    }),
  }
  ;(createServerClient as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(sb)
  return { calls }
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

describe('getMeetingRowExtras', () => {
  it('시리즈 id 로 body, 멤버 id 로 이름을 각각 한 번씩 조회해 맵으로 돌려준다', async () => {
    const { calls } = makeSb({
      meetings: OK([{ id: 'm1', body: '안건' }, { id: 'm2', body: null }]),
      members: OK([{ id: 'a', name: '홍길동' }]),
    })
    const out = await getMeetingRowExtras(['m1', 'm2'], ['a'])
    expect(out).toEqual({ bodies: { m1: '안건', m2: '' }, memberNames: { a: '홍길동' } })
    expect(calls.map(c => c.table).sort()).toEqual(['meetings', 'project_members'])
    expect(calls.find(c => c.table === 'meetings')?.inArgs).toEqual(['m1', 'm2'])
    expect(calls.find(c => c.table === 'project_members')?.inArgs).toEqual(['a'])
  })

  it('빈 id 목록은 왕복 없이 빈 맵', async () => {
    const { calls } = makeSb({})
    const out = await getMeetingRowExtras([], [])
    expect(out).toEqual({ bodies: {}, memberNames: {} })
    expect(calls).toHaveLength(0)
  })

  it('한쪽 조회가 실패해도 다른 쪽은 살리고 실패는 로깅한다(표시=로깅)', async () => {
    makeSb({ meetings: ERR('boom'), members: OK([{ id: 'a', name: '홍길동' }]) })
    const out = await getMeetingRowExtras(['m1'], ['a'])
    expect(out).toEqual({ bodies: {}, memberNames: { a: '홍길동' } })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('메모'), 'boom')
  })
})
