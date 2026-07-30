import { describe, it, expect, vi, beforeEach } from 'vitest'

// 회의록 계열은 RLS 쓰기 정책이 0개(service_role 경로)라 이 게이트가 유일한 방어선이다.
// 여기서는 '거부가 admin client 에 닿기 전에 일어나는가'를 고정한다.
const getSession = vi.fn()
const getActor = vi.fn()
const adminMocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: (...a: unknown[]) => getSession(...(a as [])) }))
vi.mock('@/lib/authz', () => ({ getActor: (...a: unknown[]) => getActor(...(a as [])) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMocks.createAdminClient }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueMinuteWikiProcessing: vi.fn(async () => null),
  processMinuteWikiJob: vi.fn(),
  rebuildProjectWikiFromActiveMinutes: vi.fn(async () => {}),
}))
vi.mock('@/lib/minutes/project', () => ({
  resolveMinuteProject: vi.fn(async () => ({ projectId: 'p1', error: null })),
}))

const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import { createMinute, deleteMinute, setMinuteShare } from '@/app/actions/minutes'

const P1 = 'p1'
const viewer = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(),
}
const memberOfP1 = { ...viewer, projectRoles: new Map([[P1, 'member' as const]]) }
const adminOfP1 = { ...viewer, projectRoles: new Map([[P1, 'admin' as const]]) }

/** minutes 테이블 단건 조회를 흉내내는 최소 빌더 */
function fakeMinutes(result: { data?: unknown; error?: { message: string } | null }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'maybeSingle', 'single']) b[m] = vi.fn(() => b)
  ;(b as { then: (r: (v: unknown) => void) => void }).then =
    resolve => resolve({ data: result.data ?? null, error: result.error ?? null })
  return { from: vi.fn(() => b) }
}

beforeEach(() => {
  getSession.mockReset(); getActor.mockReset(); createServerClient.mockReset()
  adminMocks.createAdminClient.mockReset()
  getSession.mockResolvedValue({ id: 'u1', user_metadata: {}, email: 'a@b.com' })
})

describe('회의록 액션 권한 게이트 — RLS 2차 방어선이 없는 경로', () => {
  it('조회 전용은 createMinute 거부 — admin client 에 닿지 않는다', async () => {
    getActor.mockResolvedValue(viewer)
    createServerClient.mockResolvedValue(fakeMinutes({ data: null }))
    const res = await createMinute({
      minuteDate: '2026-07-30', teamCode: 'PMO', title: '제목', bodyMd: '본문',
      meetingId: null, projectId: P1,
    } as never)
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회가 실패하면 createMinute 을 중단한다 — 관대한 폴백 금지', async () => {
    getActor.mockRejectedValue(new Error('boom'))
    const res = await createMinute({
      minuteDate: '2026-07-30', teamCode: 'PMO', title: '제목', bodyMd: '본문',
      meetingId: null, projectId: P1,
    } as never)
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('deleteMinute: 소유권 조회가 실패하면 중단한다 — admin client 미생성', async () => {
    getActor.mockResolvedValue(adminOfP1)
    createServerClient.mockResolvedValue(fakeMinutes({ error: { message: 'db down' } }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await deleteMinute('m1')
    spy.mockRestore()
    expect(res.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('deleteMinute: 작성자도 그 프로젝트 관리자도 아니면 거부', async () => {
    getActor.mockResolvedValue(memberOfP1)
    createServerClient.mockResolvedValue(fakeMinutes({
      data: { created_by: 'other', archived_at: null, project_id: P1 },
    }))
    const res = await deleteMinute('m1')
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('setMinuteShare: 프로젝트 미지정 회의록은 작성자 아니면 프로젝트 관리자여도 거부 — fail-closed(스펙 §3.5)', async () => {
    getActor.mockResolvedValue(adminOfP1)
    createServerClient.mockResolvedValue(fakeMinutes({
      data: { created_by: 'other', archived_at: null, project_id: null, share_token: null, share_enabled: false },
    }))
    const res = await setMinuteShare('m1', 'enable' as never)
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })
})
