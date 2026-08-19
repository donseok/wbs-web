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

const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'
const BAD = 'not-a-uuid'

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

/**
 * issue_updates INSERT · project_members 검증 · issues UPDATE 세 갈래를 받는 스텁.
 * issue_updates.select() 는 두 경로를 select 컬럼 문자열로 구분한다 — 미러 재계산은
 * 'body' 한 컬럼만, 목록 조회는 긴 컬럼 목록을 요청한다.
 */
function stubClient(over: {
  insertResult?: { data: unknown; error: unknown }
  memberIds?: string[]
  latestNote?: string | null
  mirrorReadError?: boolean
  mirrorUpdateRows?: unknown[]
  listRows?: unknown[]
  listError?: boolean
} = {}) {
  const calls = {
    inserted: null as Record<string, unknown> | null,
    issuePayload: null as Record<string, unknown> | null,
    mirrorChain: [] as unknown[][],
  }
  const client = {
    from(table: string) {
      if (table === 'issue_updates') {
        return {
          insert(row: Record<string, unknown>) {
            calls.inserted = row
            return { select: () => ({ maybeSingle: async () => over.insertResult ?? { data: { id: 'u1' }, error: null } }) }
          },
          select(cols: string) {
            // 미러 재계산은 'body' 한 컬럼만 읽는다 — 목록 조회와 그렇게 구분한다.
            if (cols === 'body') {
              const q: Record<string, unknown> = {}
              Object.assign(q, {
                eq: (c: string, v: unknown) => { calls.mirrorChain.push(['eq', c, v]); return q },
                is: (c: string, v: unknown) => { calls.mirrorChain.push(['is', c, v]); return q },
                order: (c: string, o?: { ascending?: boolean }) => { calls.mirrorChain.push(['order', c, o?.ascending]); return q },
                limit: async () => over.mirrorReadError
                  // 실제 Postgres 오류처럼 스키마·키가 섞인 문자열을 준다 — 이게 화면으로 새면 안 된다.
                  ? { data: null, error: { message: 'permission denied for relation issue_updates (key=secret)' } }
                  : { data: over.latestNote == null ? [] : [{ body: over.latestNote }], error: null },
              })
              return q
            }
            const q: Record<string, unknown> = {}
            Object.assign(q, {
              eq: () => q,
              order: () => q,
              then: (resolve: (v: unknown) => void) => resolve(
                over.listError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: over.listRows ?? [], error: null },
              ),
            })
            return q
          },
        }
      }
      if (table === 'project_members') {
        return {
          select: () => ({
            in: () => ({ eq: async () => ({ data: (over.memberIds ?? []).map(id => ({ id })), error: null }) }),
          }),
        }
      }
      if (table === 'issues') {
        return {
          update(payload: Record<string, unknown>) {
            calls.issuePayload = payload
            return { eq: () => ({ select: async () => ({ data: over.mirrorUpdateRows ?? [{ id: 'i1' }], error: null }) }) }
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
    const { client, calls } = stubClient({ memberIds: [M1], latestNote: '내용' })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [M1, M2] })
    expect(calls.inserted?.mentioned_member_ids).toEqual([M1])
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

describe('addIssueUpdate — 주석으로만 지켜지던 불변식', () => {
  it('INSERT 가 0행이면 실패다 — supabase-js 는 RLS 거부에도 error 를 주지 않는다', async () => {
    asMember()
    state.client = stubClient({ insertResult: { data: null, error: null } }).client
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(false)
  })

  it('미러는 이 이슈의 살아있는 note 만, 최신순으로 읽는다', async () => {
    asMember()
    const { client, calls } = stubClient({ latestNote: '내용' })
    state.client = client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    // 하나라도 빠지면 남의 이슈 메모를 미러링하거나, 취소선 친 글이 요약에 남거나,
    // 가장 오래된 메모가 최신으로 둔갑한다.
    expect(calls.mirrorChain).toContainEqual(['eq', 'issue_id', 'i1'])
    expect(calls.mirrorChain).toContainEqual(['eq', 'kind', 'note'])
    expect(calls.mirrorChain).toContainEqual(['is', 'archived_at', null])
    expect(calls.mirrorChain).toContainEqual(['order', 'created_at', false])
  })

  it('미러 UPDATE 가 0행이면 부분 실패로 고지한다 — 성공으로 뭉개지 않는다', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용', mirrorUpdateRows: [] }).client
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(true)
    expect(res.ok && res.partial).toBeTruthy()
  })

  it('미러 조회 실패도 부분 실패로 고지하되, DB 원문을 화면에 흘리지 않는다', async () => {
    asMember()
    state.client = stubClient({ mirrorReadError: true }).client
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(true)
    expect(res.ok && res.partial).toBeTruthy()
    expect(res.ok && res.partial).not.toContain('permission denied')
    expect(res.ok && res.partial).not.toContain('secret')
  })

  it('멘션 대상의 모양을 검증한다 — 배열이 아니거나 uuid 가 아니면 거부', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용' }).client
    expect((await addIssueUpdate('i1', { body: 'x', category: null, mentionedMemberIds: 'm1' as never })).ok).toBe(false)
    expect((await addIssueUpdate('i1', { body: 'x', category: null, mentionedMemberIds: [BAD] })).ok).toBe(false)
    expect((await addIssueUpdate('i1', { body: 'x', category: null, mentionedMemberIds: Array(21).fill(M1) })).ok).toBe(false)
  })
})

describe('listIssueUpdates — 조회 실패를 빈 목록으로 위장하지 않는다', () => {
  it('비로그인은 명시적 실패', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    const res = await listIssueUpdates('i1')
    expect(res.ok).toBe(false)
  })

  it('DB 오류는 명시적 실패로 돌려준다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = stubClient({ listError: true }).client
    const res = await listIssueUpdates('i1')
    expect(res.ok).toBe(false)
  })

  it('정상 조회는 행을 도메인 모델로 매핑한다', async () => {
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = stubClient({ listRows: [{
      id: 'u1', issue_id: 'i1', kind: 'note', category: 'action', body: '첫 조치',
      mentioned_member_ids: null, author_user_id: 'me', author_name: '나',
      created_at: '2026-08-19T01:00:00.000Z', archived_at: null, archived_by_name: null,
    }] }).client
    const res = await listIssueUpdates('i1')
    expect(res.ok).toBe(true)
    expect(res.ok && res.items[0]).toMatchObject({
      id: 'u1', kind: 'note', category: 'action', body: '첫 조치',
      mentionedMemberIds: [], authorName: '나', archivedAt: null,
    })
  })
})
