import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * recordMinuteFile(role:'attachment') 의 개수 상한 — 서버 쪽 관문.
 *
 * 등록 모달만 상한을 보던 동안에는 클라이언트 검사로 충분했다. 상세 화면에서 나중에 첨부를
 * 추가할 수 있게 되면 서버 액션이 유일한 관문이 되므로(회의록 계열은 RLS 쓰기 정책이
 * 얕고 개수 제약은 DB 에 없다) 여기서 세고 막아야 한다.
 *
 * 개수 조회가 실패했을 때 통과시키지 않는 것이 이 테스트의 핵심이다 — 에러 3원칙 ②·③
 * (쓰기 전 선행 조회 실패는 중단 / 가드는 fail-closed).
 */

const getSession = vi.fn()
const getActor = vi.fn()
vi.mock('@/lib/auth', () => ({ getSession: (...a: unknown[]) => getSession(...(a as [])) }))
vi.mock('@/lib/authz', () => ({ getActor: (...a: unknown[]) => getActor(...(a as [])) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
const createAdminClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: (...a: unknown[]) => createAdminClient(...(a as [])),
}))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueMinuteWikiProcessing: vi.fn(), processMinuteWikiJob: vi.fn(),
  rebuildProjectWikiFromActiveMinutes: vi.fn(),
}))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))

const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import { recordMinuteFile, removeMinuteFile } from '@/app/actions/minutes'
import { MINUTE_ATTACHMENTS_MAX_COUNT } from '@/lib/domain/minutes'

const MIN = '11111111-1111-4111-8111-111111111111'
const actor = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map<string, 'admin' | 'member'>(),
}
const FILE = {
  role: 'attachment' as const,
  fileName: '견적서.xlsx',
  filePath: `${MIN}/1700000000000-gyeonjeokseo.xlsx`,
  size: 1024,
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

type Res = { data?: unknown; error: { message: string } | null; count?: number | null }

/**
 * minutes(소유권 조회) / minute_files(개수 조회·insert) 두 테이블만 쓰는 가짜 클라이언트.
 * 첨부 개수는 head+count 질의로 오므로 count 채널을 따로 둔다.
 */
function fakeDb(opts: {
  owner?: Res
  attachmentCount?: Res
  insert?: { error: { message: string } | null }
}) {
  const insert = vi.fn(() => Promise.resolve(opts.insert ?? { error: null }))
  const countSelect = vi.fn()
  const from = vi.fn((table: string) => {
    if (table === 'minutes') {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = vi.fn(() => b)
      b.maybeSingle = vi.fn(() => Promise.resolve(opts.owner ?? {
        data: { created_by: 'u1', archived_at: null, project_id: null }, error: null,
      }))
      b.single = b.maybeSingle
      return b
    }
    // minute_files — 같은 빌더가 개수 조회와 insert 를 모두 받는다.
    const result = opts.attachmentCount ?? { data: [], error: null, count: 0 }
    const b: Record<string, unknown> & { then?: unknown } = {}
    for (const m of ['eq', 'order', 'limit', 'is']) b[m] = vi.fn(() => b)
    b.select = vi.fn((...a: unknown[]) => { countSelect(...a); return b })
    b.insert = insert
    b.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
    return b
  })
  return { from, insert, countSelect }
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  getActor.mockResolvedValue(actor)
  getSession.mockResolvedValue({ id: 'u1', email: 'u1@example.com', user_metadata: {} })
})
afterEach(() => { consoleError.mockRestore() })

describe('recordMinuteFile — 첨부 개수 상한(서버)', () => {
  it('상한 미달이면 첨부 메타를 기록한다', async () => {
    const db = fakeDb({ attachmentCount: { data: [], error: null, count: 3 } })
    createServerClient.mockResolvedValue(db)

    const res = await recordMinuteFile(MIN, FILE)

    expect(res).toEqual({ ok: true })
    expect(db.insert).toHaveBeenCalledTimes(1)
  })

  it('상한에 도달했으면 거부하고 insert 하지 않는다', async () => {
    const db = fakeDb({
      attachmentCount: { data: [], error: null, count: MINUTE_ATTACHMENTS_MAX_COUNT },
    })
    createServerClient.mockResolvedValue(db)

    const res = await recordMinuteFile(MIN, FILE)

    expect(res.ok).toBe(false)
    expect(db.insert).not.toHaveBeenCalled()
  })

  // 개수를 모르는 채 통과시키면 상한이 사실상 사라진다(fail-open).
  it('개수 조회가 실패하면 중단하고 insert 하지 않는다', async () => {
    const db = fakeDb({
      attachmentCount: { data: null, error: { message: 'boom' }, count: null },
    })
    createServerClient.mockResolvedValue(db)

    const res = await recordMinuteFile(MIN, FILE)

    expect(res.ok).toBe(false)
    expect(db.insert).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
  })

  // count 채널이 null 로 와도(질의는 성공했는데 개수를 못 받은 경우) 같은 판정이어야 한다.
  it('개수가 null 로 오면 중단한다', async () => {
    const db = fakeDb({ attachmentCount: { data: [], error: null, count: null } })
    createServerClient.mockResolvedValue(db)

    const res = await recordMinuteFile(MIN, FILE)

    expect(res.ok).toBe(false)
    expect(db.insert).not.toHaveBeenCalled()
  })

  // 상한은 첨부 전용이다. body 를 함께 세면 첨부 9개+본문 1개에서 조용히 막힌다.
  it('개수 조회는 role=attachment 로 한정한다', async () => {
    const db = fakeDb({ attachmentCount: { data: [], error: null, count: 0 } })
    createServerClient.mockResolvedValue(db)

    await recordMinuteFile(MIN, FILE)

    const eqCalls = db.from.mock.results
      .map(r => r.value as { eq?: { mock: { calls: unknown[][] } } })
      .filter(v => v?.eq)
      .flatMap(v => v.eq!.mock.calls)
    expect(eqCalls).toEqual(expect.arrayContaining([['role', 'attachment']]))
  })
})

/**
 * removeMinuteFile 의 스토리지 삭제 — service_role 로 지운다.
 *
 * `minutes` 버킷의 DELETE 정책(0021, 2026-09-26 운영 실측)은
 *   owner = auth.uid() OR app_role() = 'pmo_admin'
 * 이다. 그런데 이 액션의 게이트(checkOwner)는 **작성자 또는 프로젝트 관리자**를 통과시킨다.
 * 업로더가 아닌 프로젝트 관리자가 지우면 사용자 권한으로는 객체 삭제가 거부되고, 메타 행만
 * 지워져 **파일이 스토리지에 남는다**(고아). 화면에서는 사라지므로 아무도 눈치채지 못한다.
 *
 * 삭제 UI 가 없던 동안에는 도달 불가한 경로였다 — 상세 화면에 삭제 버튼을 붙이면서 열렸다.
 * 허가는 서버 액션이 이미 했으므로 객체 삭제는 service_role 로 수행한다.
 */
function fakeRemoveDb(opts: {
  file?: Record<string, unknown> | null
  storageError?: { message: string } | null
} = {}) {
  const fileRow = opts.file === undefined
    ? { id: 'af1', minute_id: MIN, role: 'attachment', file_path: `${MIN}/1-a.pdf` }
    : opts.file
  const userRemove = vi.fn(async () => ({ error: opts.storageError ?? null }))
  const del = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
  const from = vi.fn((table: string) => {
    if (table === 'minutes') {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = vi.fn(() => b)
      b.maybeSingle = vi.fn(async () => ({
        data: { created_by: 'other-user', archived_at: null, project_id: 'p1' }, error: null,
      }))
      return b
    }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) b[m] = vi.fn(() => b)
    b.maybeSingle = vi.fn(async () => ({ data: fileRow, error: null }))
    b.delete = del
    return b
  })
  return { client: { from, storage: { from: vi.fn(() => ({ remove: userRemove })) } }, userRemove, del }
}

/** 프로젝트 관리자(작성자 아님) — checkOwner 는 통과하지만 스토리지 정책은 막는 조합. */
const adminActor = {
  ...actor,
  projectRoles: new Map<string, 'admin' | 'member'>([['p1', 'admin']]),
}

describe('removeMinuteFile — 스토리지 객체까지 실제로 지운다', () => {
  beforeEach(() => { getActor.mockResolvedValue(adminActor) })

  it('service_role 로 객체를 지운다 — 사용자 권한으로는 남의 첨부를 못 지운다', async () => {
    const db = fakeRemoveDb()
    createServerClient.mockResolvedValue(db.client)
    const adminRemove = vi.fn(async () => ({ error: null }))
    createAdminClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove: adminRemove })) } })

    const res = await removeMinuteFile('af1')

    expect(res.ok).toBe(true)
    expect(adminRemove).toHaveBeenCalledWith([`${MIN}/1-a.pdf`])
    expect(db.userRemove).not.toHaveBeenCalled()
    expect(db.del).toHaveBeenCalled()
  })

  it('service_role 을 쓸 수 없으면 사용자 권한으로 시도하고 그 사실을 남긴다', async () => {
    const db = fakeRemoveDb()
    createServerClient.mockResolvedValue(db.client)
    createAdminClient.mockImplementation(() => { throw new Error('service_role 미설정') })

    const res = await removeMinuteFile('af1')

    expect(res.ok).toBe(true)
    expect(db.userRemove).toHaveBeenCalledWith([`${MIN}/1-a.pdf`])
    expect(consoleError).toHaveBeenCalled()
  })

  // 기존 계약 유지 — 객체가 안 지워져도 메타는 지운다(화면에서 사라지는 것이 사용자 기대).
  // 대신 고아가 생겼다는 사실을 로그로 남긴다.
  it('스토리지 삭제가 실패해도 메타는 지우고 고아를 로그로 남긴다', async () => {
    const db = fakeRemoveDb({ storageError: { message: 'denied' } })
    createServerClient.mockResolvedValue(db.client)
    createAdminClient.mockImplementation(() => { throw new Error('service_role 미설정') })

    const res = await removeMinuteFile('af1')

    expect(res.ok).toBe(true)
    expect(db.del).toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
  })

  it('본문 파일은 이 경로로 지울 수 없다', async () => {
    const db = fakeRemoveDb({ file: { id: 'bf1', minute_id: MIN, role: 'body', file_path: `${MIN}/1-b.md` } })
    createServerClient.mockResolvedValue(db.client)
    const adminRemove = vi.fn(async () => ({ error: null }))
    createAdminClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove: adminRemove })) } })

    const res = await removeMinuteFile('bf1')

    expect(res.ok).toBe(false)
    expect(adminRemove).not.toHaveBeenCalled()
    expect(db.del).not.toHaveBeenCalled()
  })
})
