import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const getActor = vi.fn()
const adminMocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const afterMock = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...(a as [])),
}))
vi.mock('@/lib/authz', () => ({
  getActor: (...a: unknown[]) => getActor(...(a as [])),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => afterMock.after(fn) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMocks.createAdminClient }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))
const rebuild = vi.hoisted(() => ({ fn: vi.fn(async () => {}) }))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  rebuildProjectWikiFromActiveMinutes: (...a: unknown[]) => rebuild.fn(...(a as [])),
}))

const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import { assignMinutesProject } from '@/app/actions/minutes'
import { MINUTES_PROJECT_BULK_MAX } from '@/lib/domain/minutes'

const P1 = '7a1c6034-a647-4673-ae85-d0b6daa2f6f3'

// 권한 3단 이행 — 일괄 지정 진입 게이트는 '대상 프로젝트 관리자 이상'(스펙 §4.3)
const adminActor = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map([[P1, 'admin' as const]]),
}
const memberActor = { ...adminActor, projectRoles: new Map([[P1, 'member' as const]]) }
const superuserActor = { ...adminActor, isSuperuser: true }
const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'
const M3 = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown>
/** 테이블별 응답을 주입하는 thenable 가짜 빌더 — select/eq/in/maybeSingle 체인 지원 */
function fakeDb(results: Record<string, { data?: unknown; error: { message: string } | null }>) {
  return {
    from: vi.fn((table: string) => {
      const result = results[table] ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'is', 'order', 'maybeSingle']) {
        b[m] = vi.fn(() => b)
      }
      ;(b as { then: (r: (v: unknown) => void) => void }).then = resolve => resolve(result)
      return b
    }),
  }
}

/** 메타 RPC 가짜 — 호출 인자를 기록하고 old/new 프로젝트를 돌려준다 */
function fakeAdmin(reply: (args: Row) => Row | null) {
  const rpc = vi.fn((_fn: string, args: Row) => {
    const data = reply(args)
    const b: Record<string, unknown> = { single: vi.fn(() => b) }
    ;(b as { then: (r: (v: unknown) => void) => void }).then =
      resolve => resolve(data ? { data, error: null } : { data: null, error: { message: 'boom' } })
    return b
  })
  // 재편철 배치가 부르는 admin.from(...) 최소 스텁 — loadFolderSnapshot(minute_folders) 을
  // 빈 스냅샷으로 통과시킨다. 이 스위트의 minuteRow 는 folder_id 를 주지 않으므로(undefined)
  // refileMinuteAfterProjectChange 는 그 즉시 no-op 이라(oldFolderId 없음) 그 이상의 from
  // 호출(minutes.update)은 발생하지 않는다 — 지정/스킵 로직 자체는 이 스텁과 무관하다.
  const from = vi.fn(() => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'update', 'eq', 'is', 'in', 'maybeSingle', 'single']) b[m] = vi.fn(() => b)
    ;(b as { then: (r: (v: unknown) => void) => void }).then = resolve => resolve({ data: [], error: null })
    return b
  })
  return { client: { rpc, from }, rpc, from }
}

const minuteRow = (id: string, over: Row = {}): Row => ({
  id, created_by: 'u1', archived_at: null, project_id: null, meeting_id: null, ...over,
})

beforeEach(() => {
  getSession.mockReset(); getActor.mockReset(); createServerClient.mockReset()
  adminMocks.createAdminClient.mockReset(); rebuild.fn.mockClear(); afterMock.after.mockReset()
  getSession.mockResolvedValue({ id: 'u1' })
  getActor.mockResolvedValue(adminActor)
  afterMock.after.mockImplementation(async (fn: () => Promise<void>) => { await fn() })
})

describe('assignMinutesProject', () => {
  it('미로그인은 거부 — DB 접근 없이', async () => {
    getSession.mockResolvedValue(null)
    getActor.mockResolvedValue(null)
    const r = await assignMinutesProject([M1], P1)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버는 대상 프로젝트로의 일괄 지정이 거부된다 — 관리자 이상만(스펙 §4.3)', async () => {
    getActor.mockResolvedValue(memberActor)
    const r = await assignMinutesProject([M1], P1)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('권한 없음')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('빈 선택은 거부', async () => {
    expect((await assignMinutesProject([], P1)).ok).toBe(false)
  })

  it(`상한(${MINUTES_PROJECT_BULK_MAX})을 넘으면 거부 — 위키 재적재가 뒤따르는 조작이다`, async () => {
    const many = Array.from({ length: MINUTES_PROJECT_BULK_MAX + 1 }, (_, i) =>
      `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`)
    const r = await assignMinutesProject(many, P1)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('없는 프로젝트로는 한 건도 건드리지 않는다', async () => {
    createServerClient.mockResolvedValue(fakeDb({ projects: { data: null, error: null } }))
    const r = await assignMinutesProject([M1], P1)
    expect(r.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('정상 지정 — 메타 RPC 로 project_id 만 patch 하고 위키를 프로젝트당 1회 재적재', async () => {
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: { data: [minuteRow(M1), minuteRow(M2)], error: null },
    }))
    const { client, rpc } = fakeAdmin(() => ({
      old_project_id: null, new_project_id: P1, wiki_rebuild_required: true,
    }))
    adminMocks.createAdminClient.mockReturnValue(client)

    const r = await assignMinutesProject([M1, M2], P1)
    expect(r).toMatchObject({ ok: true, updated: 2, unchanged: 0, skipped: [] })
    // 부분 patch — project_id 외의 메타를 실어 보내면 나머지 필드가 덮인다
    expect(rpc.mock.calls[0][1]).toEqual({ p_minute_id: M1, p_metadata: { project_id: P1 } })
    // 2건을 바꿨어도 재적재는 프로젝트 1개당 1회
    expect(rebuild.fn).toHaveBeenCalledTimes(1)
    expect(rebuild.fn).toHaveBeenCalledWith(P1)
  })

  it('이미 그 프로젝트면 쓰지 않고 unchanged 로 센다', async () => {
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: { data: [minuteRow(M1, { project_id: P1 })], error: null },
    }))
    const { client, rpc } = fakeAdmin(() => ({ old_project_id: null, new_project_id: P1, wiki_rebuild_required: false }))
    adminMocks.createAdminClient.mockReturnValue(client)
    const r = await assignMinutesProject([M1], P1)
    expect(r).toMatchObject({ ok: true, updated: 0, unchanged: 1 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('보관본·타인 회의록은 건너뛰고 사유를 돌려준다 — 조용히 빠뜨리지 않는다', async () => {
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: {
        data: [minuteRow(M1, { archived_at: '2026-07-01' }), minuteRow(M2, { created_by: 'other' })],
        error: null,
      },
    }))
    const { client, rpc } = fakeAdmin(() => ({ old_project_id: null, new_project_id: P1, wiki_rebuild_required: false }))
    adminMocks.createAdminClient.mockReturnValue(client)
    const r = await assignMinutesProject([M1, M2], P1)
    expect(r.updated).toBe(0)
    expect(r.skipped.map(s => s.id).sort()).toEqual([M1, M2].sort())
    expect(rpc).not.toHaveBeenCalled()
  })

  it('슈퍼유저는 남의 미지정 회의록도 지정할 수 있다 — 미지정은 프로젝트 판정 불가라 관리자로는 부족', async () => {
    getActor.mockResolvedValue(superuserActor)
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: { data: [minuteRow(M1, { created_by: 'other' })], error: null },
    }))
    adminMocks.createAdminClient.mockReturnValue(fakeAdmin(() => ({
      old_project_id: null, new_project_id: P1, wiki_rebuild_required: false,
    })).client)
    expect((await assignMinutesProject([M1], P1)).updated).toBe(1)
  })

  it('회의에 연결된 회의록은 회의의 프로젝트와 다르면 거절 — 회의와 어긋난 상태를 만들지 않는다', async () => {
    const MT = 'aaaaaaaa-1111-4111-8111-111111111111'
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: { data: [minuteRow(M1, { meeting_id: MT })], error: null },
      meetings: { data: [{ id: MT, project_id: 'other-project' }], error: null },
    }))
    const { client, rpc } = fakeAdmin(() => ({ old_project_id: null, new_project_id: P1, wiki_rebuild_required: false }))
    adminMocks.createAdminClient.mockReturnValue(client)
    const r = await assignMinutesProject([M1], P1)
    expect(r.updated).toBe(0)
    expect(r.skipped[0].reason).toContain('회의')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('대상 조회 실패는 중단 — 일부만 바꾸고 성공으로 보고하지 않는다(쓰기 선행조회 원칙)', async () => {
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: { data: null, error: { message: 'boom' } },
    }))
    const r = await assignMinutesProject([M1], P1)
    expect(r.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('RPC 실패는 그 건만 skipped 로 남기고 나머지는 계속 진행한다', async () => {
    createServerClient.mockResolvedValue(fakeDb({
      projects: { data: { id: P1 }, error: null },
      minutes: { data: [minuteRow(M1), minuteRow(M3)], error: null },
    }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeAdmin(args => (
      args.p_minute_id === M1 ? null : { old_project_id: null, new_project_id: P1, wiki_rebuild_required: false }
    ))
    adminMocks.createAdminClient.mockReturnValue(client)
    const r = await assignMinutesProject([M1, M3], P1)
    expect(r.ok).toBe(true)
    expect(r.updated).toBe(1)
    expect(r.skipped.map(s => s.id)).toEqual([M1])
    spy.mockRestore()
  })

  it('연결 해제(null)도 지원 — 옛 프로젝트 위키를 재적재한다', async () => {
    createServerClient.mockResolvedValue(fakeDb({
      minutes: { data: [minuteRow(M1, { project_id: P1 })], error: null },
    }))
    adminMocks.createAdminClient.mockReturnValue(fakeAdmin(() => ({
      old_project_id: P1, new_project_id: null, wiki_rebuild_required: false,
    })).client)
    const r = await assignMinutesProject([M1], null)
    expect(r).toMatchObject({ ok: true, updated: 1 })
    expect(rebuild.fn).toHaveBeenCalledWith(P1)
  })
})
