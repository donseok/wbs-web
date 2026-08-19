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
const { emitNotification } = vi.hoisted(() => ({ emitNotification: vi.fn(async () => ({ ok: true })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification }))

import { getSession } from '@/lib/auth'
import { addIssueUpdate, archiveIssueUpdate, listIssueUpdates, purgeIssueUpdate, unarchiveIssueUpdate } from '@/app/actions/issueUpdates'

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
  assigneeIds?: string[]
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
      if (table === 'issue_assignees') {
        return { select: () => ({ eq: async () => ({ data: (over.assigneeIds ?? []).map(id => ({ member_id: id })), error: null }) }) }
      }
      if (table === 'issues') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: '이슈 제목' }, error: null }) }) }),
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
    expect(calls.mirrorChain).toContainEqual(['order', 'id', false])
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

describe('addIssueUpdate 알림', () => {
  it('담당자에게 issue.update 를 member 축으로 보낸다', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용', assigneeIds: ['m1', 'm2'] }).client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'issue.update',
      projectId: 'p1',
      actorUserId: 'me',
      recipientMemberIds: ['m1', 'm2'],
      dedupeKey: 'issue.update:i1:u1',
    }))
    // auth uuid 축으로 보내면 안 된다 — 클라이언트에도 서버 액션에도 그 값이 없다.
    expect(emitNotification).not.toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: expect.anything() }))
  })

  it('담당자가 없으면 알림을 보내지 않는다', async () => {
    asMember()
    state.client = stubClient({ latestNote: '내용', assigneeIds: [] }).client
    await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('알림 실패가 이력 저장을 실패로 만들지는 않는다 — 부분 실패로 고지한다', async () => {
    asMember()
    emitNotification.mockResolvedValueOnce({ ok: false })
    state.client = stubClient({ latestNote: '내용', assigneeIds: ['m1'] }).client
    const res = await addIssueUpdate('i1', { body: '내용', category: null, mentionedMemberIds: [] })
    expect(res.ok).toBe(true)
    expect(res.ok && res.partial).toBeTruthy()
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

/** 취소선·삭제용 스텁. 필터 체인과 미러 호출 여부를 기록한다 — 기록하지 않으면 테스트가 그것을 볼 수 없다. */
function stubRowClient(
  row: { author_user_id: string | null; kind: string; archived_at: string | null } | null,
  opts: { updatedRows?: unknown[]; deletedRows?: unknown[]; rowError?: boolean } = {},
) {
  const calls = {
    readChain: [] as unknown[][],
    writeChain: [] as unknown[][],
    deleteChain: [] as unknown[][],
    updatePayload: null as Record<string, unknown> | null,
    deleted: false,
    mirrorRan: false,
  }
  const client = {
    from(table: string) {
      if (table === 'issue_updates') {
        return {
          select(cols: string) {
            const q: Record<string, unknown> = {}
            if (cols === 'body') {
              // 미러 재계산 경로 — 살아있는 note 가 없다고 답한다.
              Object.assign(q, {
                eq: () => q, is: () => q, order: () => q,
                limit: async () => ({ data: [], error: null }),
              })
              return q
            }
            // 대상 행 조회 경로 — 어떤 필터로 좁혔는지 기록한다.
            Object.assign(q, {
              eq: (c: string, v: unknown) => { calls.readChain.push(['eq', c, v]); return q },
              maybeSingle: async () => {
                if (opts.rowError) {
                  return { data: null, error: { message: 'permission denied for relation issue_updates (key=secret)' } }
                }
                if (row === null) return { data: null, error: null }
                // 실제 PostgREST 는 select 에 적은 컬럼만 돌려준다. 스텁이 행을 통째로 주면
                // select 목록에서 컬럼을 빠뜨려도 테스트는 초록이고 운영에서만 undefined 가 된다
                // — 스텁이 코드와 같은 방향으로 틀리는 경우다.
                const picked: Record<string, unknown> = {}
                for (const c of cols.split(',').map(s => s.trim())) {
                  if (c in row) picked[c] = (row as unknown as Record<string, unknown>)[c]
                }
                return { data: picked, error: null }
              },
            })
            return q
          },
          update(payload: Record<string, unknown>) {
            calls.updatePayload = payload
            const q: Record<string, unknown> = {}
            Object.assign(q, {
              eq: (c: string, v: unknown) => { calls.writeChain.push(['eq', c, v]); return q },
              is: (c: string, v: unknown) => { calls.writeChain.push(['is', c, v]); return q },
              not: (c: string, o: string, v: unknown) => { calls.writeChain.push(['not', c, o, v]); return q },
              select: async () => ({ data: opts.updatedRows ?? [{ id: 'u1' }], error: null }),
            })
            return q
          },
          delete() {
            calls.deleted = true
            const q: Record<string, unknown> = {}
            Object.assign(q, {
              eq: (c: string, v: unknown) => { calls.deleteChain.push(['eq', c, v]); return q },
              select: async () => ({ data: opts.deletedRows ?? [{ id: 'u1' }], error: null }),
            })
            return q
          },
        }
      }
      if (table === 'issues') {
        return {
          update: () => {
            calls.mirrorRan = true
            return { eq: () => ({ select: async () => ({ data: [{ id: 'i1' }], error: null }) }) }
          },
        }
      }
      throw new Error(`예상치 못한 테이블 접근: ${table}`)
    },
  }
  return { client, calls }
}

describe('archiveIssueUpdate — 취소선은 작성자 또는 관리자', () => {
  it('남의 이력은 멤버가 못 긋는다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: null }).client
    const res = await archiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(false)
  })

  it('작성자 본인은 그을 수 있고 취소 주체가 본인으로 기록된다', async () => {
    asMember()
    const { client, calls } = stubRowClient({ author_user_id: 'me', kind: 'note', archived_at: null })
    state.client = client
    const res = await archiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(true)
    expect(calls.updatePayload).toMatchObject({ archived_by: 'me', archived_by_name: '나' })
    expect(calls.updatePayload?.archived_at).toEqual(expect.any(String))
  })

  it('관리자는 남의 이력도 긋는다', async () => {
    asMember()
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client } = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: null })
    state.client = client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(true)
  })

  it('이미 그어진 이력은 거부한다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', kind: 'note', archived_at: '2026-08-19T00:00:00Z' }).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('CAS 0행은 실패다 — 경합을 성공으로 뭉개지 않는다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', kind: 'note', archived_at: null }, { updatedRows: [] }).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('없는 이력은 실패다', async () => {
    asMember()
    state.client = stubRowClient(null).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })
})

describe('unarchiveIssueUpdate — 되돌리기 경로는 반드시 있어야 한다', () => {
  it('작성자가 되돌리면 archived_* 가 전부 NULL 이 된다', async () => {
    asMember()
    const { client, calls } = stubRowClient({ author_user_id: 'me', kind: 'note', archived_at: '2026-08-19T00:00:00Z' })
    state.client = client
    const res = await unarchiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(true)
    expect(calls.updatePayload).toEqual({ archived_at: null, archived_by: null, archived_by_name: null })
  })

  it('그어지지 않은 이력은 되돌릴 것이 없다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', kind: 'note', archived_at: null }).client
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })
})

describe('purgeIssueUpdate — 완전 삭제는 관리자만', () => {
  it('멤버는 자기 이력도 완전삭제할 수 없다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'me', kind: 'note', archived_at: null }).client
    const res = await purgeIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(false)
  })

  it('관리자는 삭제하고 미러가 재계산된다', async () => {
    asMember()
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, calls } = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: null })
    state.client = client
    const res = await purgeIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(true)
    expect(calls.deleted).toBe(true)
    // DELETE 는 PK 한 행만. issue_id 로 걸면 그 이슈의 이력이 통째로 사라진다.
    expect(calls.deleteChain).toContainEqual(['eq', 'id', 'u1'])
  })

  it('DELETE 0행은 실패다', async () => {
    asMember()
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: null }, { deletedRows: [] }).client
    expect((await purgeIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('관리자는 상태 기록도 완전 삭제할 수 있다 — 취소선만 막았지 삭제를 막은 게 아니다', async () => {
    asMember(); requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = stubRowClient({ author_user_id: 'me', kind: 'status', archived_at: null }).client
    expect((await purgeIssueUpdate('i1', 'u1')).ok).toBe(true)
  })
})

describe('Task 4 불변식 — 주석과 제목으로만 지켜지던 것들', () => {
  const LIVE = { author_user_id: 'me', kind: 'note', archived_at: null }
  const ARCHIVED = { author_user_id: 'me', kind: 'note', archived_at: '2026-08-19T00:00:00.000Z' }

  it('남의 이력은 멤버가 되돌릴 수 없고, 관리자는 되돌린다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: '2026-08-19T00:00:00.000Z' }).client
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(false)

    asMember(); requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: '2026-08-19T00:00:00.000Z' }).client
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(true)
  })

  it('대상 행을 issue_id 로도 좁힌다 — 권한 있는 이슈 id 에 남의 이력 id 를 붙여 보내는 경로를 막는다', async () => {
    asMember()
    const { client, calls } = stubRowClient(LIVE)
    state.client = client
    await archiveIssueUpdate('i1', 'u1')
    expect(calls.readChain).toContainEqual(['eq', 'id', 'u1'])
    expect(calls.readChain).toContainEqual(['eq', 'issue_id', 'i1'])
    // UPDATE 는 PK 한 행만 — issue_id 로 걸면 그 이슈의 살아있는 이력이 전부 그어진다.
    expect(calls.writeChain).toContainEqual(['eq', 'id', 'u1'])
  })

  it('취소선·되돌리기·완전삭제 뒤 미러를 재계산한다 — 안 하면 지운 글이 챗봇 지식에 남는다', async () => {
    asMember(); requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    const a = stubRowClient(LIVE); state.client = a.client
    await archiveIssueUpdate('i1', 'u1'); expect(a.calls.mirrorRan).toBe(true)
    const b = stubRowClient(ARCHIVED); state.client = b.client
    await unarchiveIssueUpdate('i1', 'u1'); expect(b.calls.mirrorRan).toBe(true)
    const c = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: null }); state.client = c.client
    await purgeIssueUpdate('i1', 'u1'); expect(c.calls.mirrorRan).toBe(true)
  })

  it('관리자가 남의 이력을 그어도 취소 주체는 관리자 본인이다', async () => {
    asMember(); requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    const { client, calls } = stubRowClient({ author_user_id: 'other', kind: 'note', archived_at: null })
    state.client = client
    await archiveIssueUpdate('i1', 'u1')
    // 0087 의 with check 가 archived_by = auth.uid() 를 요구한다. 행 작성자를 넣으면 42501.
    expect(calls.updatePayload?.archived_by).toBe('me')
  })

  it('CAS 가드가 양쪽에 걸려 있다', async () => {
    asMember()
    const a = stubRowClient(LIVE); state.client = a.client
    await archiveIssueUpdate('i1', 'u1')
    expect(a.calls.writeChain).toContainEqual(['is', 'archived_at', null])
    const b = stubRowClient(ARCHIVED); state.client = b.client
    await unarchiveIssueUpdate('i1', 'u1')
    expect(b.calls.writeChain).toContainEqual(['not', 'archived_at', 'is', null])
  })

  it('되돌리기 CAS 가 0행이면 실패다', async () => {
    asMember()
    state.client = stubRowClient(ARCHIVED, { updatedRows: [] }).client
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('대상 행 조회 실패는 진행이 아니라 중단이고, DB 원문을 화면에 흘리지 않는다', async () => {
    asMember(); requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = stubRowClient(null, { rowError: true }).client
    const res = await archiveIssueUpdate('i1', 'u1')
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).not.toContain('permission denied')
    expect(res.ok === false && res.error).not.toContain('secret')
  })

  it('조회 전용 사용자는 셋 다 거부되고 DB 에 닿지 않는다', async () => {
    asViewer()
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(false)
    expect((await purgeIssueUpdate('i1', 'u1')).ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('표시 이름이 없어도 archived_by_name 을 비우지 않는다 — 짝 제약 23514 위반이 된다', async () => {
    asMember()
    vi.mocked(getSession).mockResolvedValue({ id: 'me', email: null, user_metadata: {} } as never)
    const { client, calls } = stubRowClient(LIVE)
    state.client = client
    await archiveIssueUpdate('i1', 'u1')
    expect(calls.updatePayload?.archived_by_name).toBeTruthy()
  })

  it('작성자 계정이 삭제된 이력은 멤버가 못 긋는다 — null 끼리 같다고 통과시키면 안 된다', async () => {
    asMember()
    state.client = stubRowClient({ author_user_id: null, kind: 'note', archived_at: null }).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })

  it('상태 자동 기록은 취소선 대상이 아니다 — 감사 흔적이다', async () => {
    asMember(); requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = stubRowClient({ author_user_id: 'me', kind: 'status', archived_at: null }).client
    expect((await archiveIssueUpdate('i1', 'u1')).ok).toBe(false)
    state.client = stubRowClient({ author_user_id: 'me', kind: 'status', archived_at: '2026-08-19T00:00:00.000Z' }).client
    expect((await unarchiveIssueUpdate('i1', 'u1')).ok).toBe(false)
  })
})
