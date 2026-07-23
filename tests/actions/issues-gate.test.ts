import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다. 각 테스트가 state.client 를
// 지정하지 않으면 호출 즉시 throw — "게이트 전 DB 접근 없음"을 기본값으로 강제한다.
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getMembership, getSession } from '@/lib/auth'
import { createIssue, updateIssue, updateIssueProgress, deleteIssue } from '@/app/actions/issues'

const MEMBER = { role: 'team_editor', teamCode: 'PMO', teamId: 't1' } as const
const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const

const INPUT = { title: '테스트 이슈', body: '', severity: 'medium', assigneeMemberId: null, dueDate: null } as const

/** 선검증 조회(maybeSingle) 스텁 — from().select().eq().maybeSingle() 체인만 지원. */
function sbWithCurrent(current: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: current })) })) })),
      update: vi.fn(() => { throw new Error('게이트 전 update 금지') }),
      delete: vi.fn(() => { throw new Error('게이트 전 delete 금지') }),
      insert: vi.fn(() => { throw new Error('게이트 전 insert 금지') }),
      ...extra,
    })),
  }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  vi.mocked(getMembership).mockReset()
  vi.mocked(getSession).mockReset()
})

describe('멤버십 게이트 — 비멤버는 전부 거부 + DB 무접근', () => {
  it.each([
    ['createIssue', () => createIssue('p1', { ...INPUT })],
    ['updateIssue', () => updateIssue('i1', { ...INPUT })],
    ['updateIssueProgress', () => updateIssueProgress('i1', { status: 'in_progress' })],
    ['deleteIssue', () => deleteIssue('i1')],
  ] as const)('%s: 멤버십 없음 → ok:false, DB 미호출', async (_name, run) => {
    vi.mocked(getMembership).mockResolvedValue(null)
    const res = await run()
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('작성자/pmo 게이트 — updateIssue·deleteIssue', () => {
  it('작성자도 pmo도 아니면 권한 없음 (선검증 조회까지만, update/delete 미호출)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other' })
    const up = await updateIssue('i1', { ...INPUT })
    expect(up).toMatchObject({ ok: false, error: '권한 없음' })
    const del = await deleteIssue('i1')
    expect(del).toMatchObject({ ok: false, error: '권한 없음' })
  })
  it('이슈가 없으면 안내 반환', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = sbWithCurrent(null)
    const res = await updateIssue('i1', { ...INPUT })
    expect(res.ok).toBe(false)
  })
})

describe('updateIssueProgress — 전환 검증 + CAS', () => {
  it('전환 맵에 없는 전환은 거부 (resolved→on_hold)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other', status: 'resolved', resolved_at: '2026-07-20T00:00:00Z' })
    const res = await updateIssueProgress('i1', { status: 'on_hold' })
    expect(res.ok).toBe(false)
  })
  it('CAS 0행이면 conflict:true (다른 사용자 선변경)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { project_id: 'p1', created_by: 'other', status: 'open', resolved_at: null } })) })) })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })) })),
        })),
      })),
    }
    const res = await updateIssueProgress('i1', { status: 'in_progress' })
    expect(res).toMatchObject({ ok: false, conflict: true })
  })
})

describe('입력 검증 — createIssue', () => {
  it('빈 제목 거부 (게이트 통과 후에도 DB insert 미도달)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createIssue('p1', { ...INPUT, title: '   ' })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('잘못된 날짜 형식 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createIssue('p1', { ...INPUT, dueDate: '2026-02-30' })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
