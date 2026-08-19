import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다(issues-gate.test.ts 와 같은 규약).
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectMember, requireProjectAdmin, resolveProjectId } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getSession } from '@/lib/auth'
import { addIssueUpdate, listIssueUpdates } from '@/app/actions/issueUpdates'

const ACTOR = { userId: 'me', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['p1', 'member']]) }
const USER = { id: 'me', email: 'me@x.com', user_metadata: { full_name: '나' } }

function asMember() {
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  vi.mocked(getSession).mockResolvedValue(USER as never)
}
function asViewer() {
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  vi.mocked(getSession).mockResolvedValue(USER as never)
}

/** issue_updates INSERT · project_members 검증 · issues UPDATE 세 갈래를 받는 최소 스텁. */
function stubClient(over: {
  insertResult?: { data: unknown; error: unknown }
  memberIds?: string[]
  latestNote?: string | null
  issueUpdateRows?: unknown[]
} = {}) {
  const calls = { inserted: null as Record<string, unknown> | null, issuePayload: null as Record<string, unknown> | null }
  const client = {
    from(table: string) {
      if (table === 'issue_updates') {
        return {
          insert(row: Record<string, unknown>) {
            calls.inserted = row
            return { select: () => ({ maybeSingle: async () => over.insertResult ?? { data: { id: 'u1' }, error: null } }) }
          },
          select() {
            const q: Record<string, unknown> = {}
            const chain = () => q
            Object.assign(q, {
              eq: chain, is: chain, order: chain,
              limit: async () => ({ data: over.latestNote == null ? [] : [{ body: over.latestNote }], error: null }),
              then: undefined,
            })
            return q
          },
        }
      }
      if (table === 'project_members') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: (over.memberIds ?? []).map(id => ({ id })), error: null }),
            }),
          }),
        }
      }
      if (table === 'issues') {
        return {
          update(payload: Record<string, unknown>) {
            calls.issuePayload = payload
            return { eq: () => ({ select: async () => ({ data: [{ id: 'i1' }], error: null }) }) }
          },
        }
      }
      throw new Error(`예상치 못한 테이블 접근: ${table}`)
    },
  }
  return { client, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.client = undefined
})

describe('addIssueUpdate — 등록은 프로젝트 멤버', () => {
  it('조회 전용 사용자는 거부되고 DB 에 닿지 않는다', async () => {
    asViewer()
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버는 등록할 수 있고 작성자는 서버가 정한다', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: '내용' })
    state.client = client
    const res = await addIssueUpdate('i1', { body: '  내용  ', category: 'action', mentionedMemberIds: [] })
    expect(res.ok).toBe(true)
    expect(calls.inserted).toMatchObject({
      issue_id: 'i1', project_id: 'p1', body: '내용', category: 'action', author_user_id: 'me', author_name: '나',
    })
    // kind 는 클라이언트가 정하지 않는다 — 컬럼 grant 밖이라 보내면 42501 이다.
    expect(calls.inserted).not.toHaveProperty('kind')
  })

  it('빈 본문과 상한 초과를 거부한다', async () => {
    asMember()
    state.client = stubClient().client
    expect((await addIssueUpdate('i1', { body: '   ', category: null, mentionedMemberIds: [] })).ok).toBe(false)
    expect((await addIssueUpdate('i1', { body: 'x'.repeat(4001), category: null, mentionedMemberIds: [] })).ok).toBe(false)
  })

  it('알 수 없는 분류를 거부한다 — 0087 CHECK 에 걸리기 전에 잡는다', async () => {
    asMember()
    state.client = stubClient().client
    const res = await addIssueUpdate('i1', { body: '내용', category: 'resolution' as never, mentionedMemberIds: [] })
    expect(res.ok).toBe(false)
  })

  it('이 프로젝트 소속이 아닌 멘션 대상은 걸러진다', async () => {
    asMember()
    const { client, calls } = stubClient({ memberIds: ['m1'], latestNote: '내용' })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: ['m1', 'm-남의프로젝트'] })
    expect(calls.inserted?.mentioned_member_ids).toEqual(['m1'])
  })

  it('부모 issues UPDATE 는 허용 키 두 개만 싣는다 — 0062 트리거가 막아주지 않는다', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: '내용' })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(Object.keys(calls.issuePayload ?? {}).sort()).toEqual(['resolution_note', 'updated_at'])
    expect(calls.issuePayload?.resolution_note).toBe('내용')
  })

  it('살아있는 이력이 없으면 미러는 빈 문자열이다 — NULL 은 NOT NULL 위반(23502)', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: null })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(calls.issuePayload?.resolution_note).toBe('')
  })
})

describe('listIssueUpdates — 조회 실패를 빈 목록으로 위장하지 않는다', () => {
  it('비로그인은 명시적 실패', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    const res = await listIssueUpdates('i1')
    expect(res.ok).toBe(false)
  })
})
