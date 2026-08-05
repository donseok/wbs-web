import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다(issues-gate.test.ts 와 같은 강제).
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getSession } from '@/lib/auth'
import {
  listIssueAttachments,
  recordIssueAttachment,
  removeIssueAttachment,
} from '@/app/actions/issueAttachments'
import { ISSUE_ATTACHMENT_MAX_BYTES } from '@/lib/domain/issueAttachments'

const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const
const ACTOR = { userId: 'me', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['p1', 'member']]) }
const ISSUE = 'i1'
const FILE = { fileName: '보고서.pdf', filePath: `${ISSUE}/1700000000000-_.pdf`, size: 1234, mime: 'application/pdf' }

function asOwner() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue(ACTOR)
}
function asOtherMember() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue({ ...ACTOR, userId: 'someone-else' })
}
function asProjectAdmin() {
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  getActor.mockResolvedValue(ACTOR)
}
function asAnon() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
  getActor.mockResolvedValue(null)
}

/** 호출 순서를 기록해 "storage 제거가 메타 삭제보다 먼저"를 검증할 수 있게 한다. */
type Calls = string[]

function makeClient(opts: {
  calls?: Calls
  /** issues 선행 조회 결과(작성자 판정용). */
  issue?: { data: { created_by: string | null } | null; error: { message: string } | null }
  /** 기존 첨부 개수 조회 결과. */
  countRows?: { data: Array<{ id: string }> | null; error: { message: string } | null }
  /** 첨부 단건 조회(삭제용). */
  attachment?: { data: { id: string; file_path: string; issue_id: string } | null; error: { message: string } | null }
  /** 목록 조회. */
  listRows?: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
  insertError?: { message: string } | null
  deleteError?: { message: string } | null
  /** 메타 delete 가 0행을 지웠을 때를 흉내낸다. */
  deleteResult?: { data: { id: string } | null; error: { message: string } | null }
  signed?: { data: { signedUrl: string } | null; error: { message: string } | null }
}) {
  const calls = opts.calls ?? []
  const insert = vi.fn(async (row: unknown) => { calls.push('meta.insert'); void row; return { error: opts.insertError ?? null } })
  const remove = vi.fn(async (paths: string[]) => { calls.push('storage.remove'); void paths; return { data: [], error: null } })
  const createSignedUrl = vi.fn(async () => opts.signed ?? { data: { signedUrl: 'https://signed' }, error: null })

  const issuesTable = {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => opts.issue ?? { data: { created_by: 'me' }, error: null }) })) })),
  }
  // 실제 PostgrestFilterBuilder 는 thenable 이다 — .eq(...) 를 그대로 await 하면 쿼리가 돈다.
  // 개수 조회가 그 경로를 쓰므로 mock 도 thenable 이어야 한다.
  const attachChain = () => ({
    maybeSingle: vi.fn(async () => opts.attachment ?? { data: null, error: null }),
    order: vi.fn(async () => opts.listRows ?? { data: [], error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(opts.countRows ?? { data: [], error: null }).then(res, rej),
  })
  const attachTable = {
    select: vi.fn(() => ({ eq: vi.fn(attachChain) })),
    insert,
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            calls.push('meta.delete')
            return opts.deleteResult ?? { data: { id: 'a1' }, error: opts.deleteError ?? null }
          }),
        })),
      })),
    })),
  }
  return {
    calls,
    insert,
    remove,
    createSignedUrl,
    client: {
      from: vi.fn((t: string) => (t === 'issues' ? issuesTable : attachTable)),
      storage: { from: vi.fn(() => ({ createSignedUrl, remove })) },
    },
  }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  vi.mocked(getSession).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
})

describe('권한 게이트', () => {
  it('비로그인은 첨부를 기록할 수 없고 DB 에 닿지 않는다', async () => {
    asAnon()
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // 삭제는 "어느 이슈의 첨부인가"를 알아야 권한을 판정할 수 있어 게이트 전에 첨부 행을 읽는다
  // (기존 removeAttachment 도 같은 순서다). 실제로는 RLS 가 비로그인 조회를 막아 빈 결과가 되지만,
  // 여기서는 행이 보이는 최악의 경우에도 삭제가 막히는지를 본다.
  it('비로그인은 첨부를 지울 수 없다 — 행이 보여도 삭제까지 가지 않는다', async () => {
    asAnon()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
    })
    state.client = m.client
    const res = await removeIssueAttachment('a1')
    expect(res.ok).toBe(false)
    expect(m.remove).not.toHaveBeenCalled()
    expect(m.calls).toEqual([])
  })

  it('작성자도 관리자도 아니면 거부하고 insert 하지 않는다', async () => {
    asOtherMember()
    const m = makeClient({ issue: { data: { created_by: 'me' }, error: null } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('작성자는 기록할 수 있다', async () => {
    asOwner()
    const m = makeClient({ issue: { data: { created_by: 'me' }, error: null } })
    state.client = m.client
    expect((await recordIssueAttachment(ISSUE, FILE)).ok).toBe(true)
  })

  it('프로젝트 관리자는 남의 이슈에도 기록할 수 있다', async () => {
    asProjectAdmin()
    const m = makeClient({ issue: { data: { created_by: 'someone-else' }, error: null } })
    state.client = m.client
    expect((await recordIssueAttachment(ISSUE, FILE)).ok).toBe(true)
  })

  it('이슈 조회가 실패하면 권한 없음이 아니라 중단한다', async () => {
    asOwner()
    const m = makeClient({ issue: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('프로젝트를 확정하지 못하면 중단한다', async () => {
    asOwner()
    resolveProjectId.mockResolvedValue({ ok: true, projectId: null })
    const m = makeClient({})
    state.client = m.client
    expect((await recordIssueAttachment(ISSUE, FILE)).ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })
})

describe('recordIssueAttachment 검증', () => {
  it('다른 이슈 접두의 경로는 거부한다 — 편집 권한 하나로 남의 객체를 꽂지 못하게', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, { ...FILE, filePath: 'other-issue/1-x.pdf' })
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('상한을 넘는 크기는 거부한다', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, { ...FILE, size: ISSUE_ATTACHMENT_MAX_BYTES + 1 })
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('이미 10개면 거부한다', async () => {
    asOwner()
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }))
    const m = makeClient({ countRows: { data: rows, error: null } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('개수 조회가 실패하면 통과시키지 않고 중단한다', async () => {
    asOwner()
    const m = makeClient({ countRows: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await recordIssueAttachment(ISSUE, FILE)
    expect(res.ok).toBe(false)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('project_id 는 클라이언트가 아니라 서버가 확정한 값을 넣는다', async () => {
    asOwner()
    const m = makeClient({})
    state.client = m.client
    await recordIssueAttachment(ISSUE, FILE)
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ issue_id: ISSUE, project_id: 'p1' }))
  })
})

describe('removeIssueAttachment', () => {
  it('첨부 조회가 실패하면 중단한다', async () => {
    asOwner()
    const m = makeClient({ attachment: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const res = await removeIssueAttachment('a1')
    expect(res.ok).toBe(false)
    expect(m.remove).not.toHaveBeenCalled()
  })

  it('없는 첨부는 거부한다', async () => {
    asOwner()
    const m = makeClient({ attachment: { data: null, error: null } })
    state.client = m.client
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
  })

  it('Storage 객체를 메타 행보다 먼저 지운다 — 반대면 메타 잃은 객체를 못 찾는다', async () => {
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
    })
    state.client = m.client
    const res = await removeIssueAttachment('a1')
    expect(res.ok).toBe(true)
    expect(m.calls).toEqual(['storage.remove', 'meta.delete'])
  })

  it('메타가 0행 지워지면 성공으로 둔갑시키지 않는다', async () => {
    // Storage 객체는 이미 지웠는데 메타가 남으면 목록에 죽은 링크가 영구히 남는다.
    // supabase-js 는 0행 삭제에 error 를 주지 않으므로 .select() 로 직접 확인해야 한다.
    asOwner()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      deleteResult: { data: null, error: null },
    })
    state.client = m.client
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
  })

  it('권한이 없으면 Storage 에 손대지 않는다', async () => {
    asOtherMember()
    const m = makeClient({
      attachment: { data: { id: 'a1', file_path: `${ISSUE}/1-x.pdf`, issue_id: ISSUE }, error: null },
      issue: { data: { created_by: 'me' }, error: null },
    })
    state.client = m.client
    expect((await removeIssueAttachment('a1')).ok).toBe(false)
    expect(m.remove).not.toHaveBeenCalled()
  })
})

describe('listIssueAttachments', () => {
  it('비로그인은 실패로 알린다 — 빈 목록으로 위장하지 않는다', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listIssueAttachments(ISSUE)).toMatchObject({ ok: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('조회 실패를 "첨부 없음"으로 위장하지 않는다', async () => {
    // 목록 배지는 getIssues 의 별도 쿼리에서 오므로, 여기서 [] 를 돌려주면
    // 목록은 '첨부 3개'인데 상세는 '없음'이 되어 사용자가 파일 소실로 읽는다.
    const m = makeClient({ listRows: { data: null, error: { message: 'boom' } } })
    state.client = m.client
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listIssueAttachments(ISSUE)).toMatchObject({ ok: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('서명 URL 실패를 삼키지 않는다 — 표시 = 로깅', async () => {
    const m = makeClient({
      listRows: {
        data: [{ id: 'a1', issue_id: ISSUE, file_name: 'x.pdf', file_path: `${ISSUE}/1-x.pdf`, size: 1, mime: null, created_at: 't' }],
        error: null,
      },
      signed: { data: null, error: { message: 'signing failed' } },
    })
    state.client = m.client
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await listIssueAttachments(ISSUE)
    expect(out.ok).toBe(true)
    const items = (out as { items: Array<{ url: string | null }> }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.url).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('원본 파일명으로 내려받도록 서명 URL 에 download 를 준다', async () => {
    const m = makeClient({
      listRows: {
        data: [{ id: 'a1', issue_id: ISSUE, file_name: '보고서.pdf', file_path: `${ISSUE}/1-x.pdf`, size: 1, mime: null, created_at: 't' }],
        error: null,
      },
    })
    state.client = m.client
    await listIssueAttachments(ISSUE)
    expect(m.createSignedUrl).toHaveBeenCalledWith(`${ISSUE}/1-x.pdf`, 3600, { download: '보고서.pdf' })
  })
})
