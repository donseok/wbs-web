import { describe, it, expect, vi, beforeEach } from 'vitest'

// WBS·프로젝트 액션의 권한 게이트만 검증한다(본문 로직은 다루지 않는다).
// 핵심 불변식 셋:
//  ① 가드가 거부하면 그 문구 그대로 반환하고 DB 클라이언트를 만들지 않는다.
//  ② projectId 를 인자로 받지 않는 액션은 resolveProjectId 로 읽은 project_id 로 판정한다.
//  ③ resolveProjectId 가 실패하면(조회 실패·대상 없음) 가드를 부르지도 않고 쓰기를 중단한다.

// 게이트 통과 전 DB 접근이 있으면 즉시 실패시키는 기본값 — 각 테스트가 state.client 를 지정해야 통과한다.
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(), resolveProjectId: vi.fn(),
}))
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// after() 는 요청 스코프 밖에서 throw — NextResponse 는 라우트가 실제로 쓰므로 원본을 유지한다.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({
  requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession, getMembership: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))
vi.mock('@/lib/excel/parse', () => ({ parseWbsWorkbook: vi.fn(() => ({ rows: [], holidays: [] })) }))
vi.mock('@/lib/excel/validate', () => ({
  validateAndLink: vi.fn(() => ({ ok: true, items: [] })), splitLeafOwners: vi.fn((i: unknown) => i),
}))
vi.mock('@/lib/teams/master', () => ({ teamsSync: vi.fn(() => []) }))

import {
  updateActual, updateWeight, updateDeliverable, addWbsItem, addSubAct,
  updateWbsFields, deleteWbsItem, moveWbsItem, addTaskDependency, removeTaskDependency,
  getChangeLogs,
} from '@/app/actions/wbs'
import { createProject, updateProject, setBaseDate, addHoliday, removeHoliday } from '@/app/actions/project'
import { POST as IMPORT_POST } from '@/app/api/import/route'

const DENIED = { ok: false as const, error: '권한 없음' }
const ANON = { ok: false as const, error: '로그인 필요' }
const LOOKUP_FAILED = { ok: false as const, error: '권한을 확인할 수 없어 중단했습니다.' }
const MISSING = { ok: false as const, error: '대상을 찾을 수 없습니다.' }
const ACTOR = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map(),
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  resolveProjectId.mockReset()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  requireSuperuser.mockReset()
  getSession.mockReset()
  // 기본값: 대상 행은 p1 프로젝트에 있다. 가드 결과는 각 테스트가 정한다.
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
})

describe('멤버 가드 — 조회 전용 사용자는 실적·산출물 입력 거부 + DB 무접근', () => {
  it.each([
    ['updateActual', () => updateActual('i1', 50)],
    ['updateDeliverable', () => updateDeliverable('i1', '설계서')],
  ] as const)('%s: 거부 문구 그대로 반환', async (_name, run) => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await run()
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createServerClient).not.toHaveBeenCalled()
    expect(requireProjectMember).toHaveBeenCalledWith('p1')
  })

  it('비로그인은 로그인 필요 문구를 그대로 전달한다', async () => {
    requireProjectMember.mockResolvedValue(ANON)
    expect(await updateActual('i1', 50)).toEqual({ ok: false, error: '로그인 필요' })
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('관리자 가드 — 멤버(관리자 아님)는 구조·일정·가중치 변경 거부 + DB 무접근', () => {
  it.each([
    ['updateWeight', () => updateWeight('i1', 3)],
    ['updateWbsFields', () => updateWbsFields('i1', { name: '새 이름' })],
    ['addSubAct', () => addSubAct('a1', 'PMO', 'primary')],
    ['deleteWbsItem', () => deleteWbsItem('i1')],
    ['moveWbsItem', () => moveWbsItem('i1', 'up')],
    ['removeTaskDependency', () => removeTaskDependency('d1')],
    ['addWbsItem', () => addWbsItem('p1', null, '신규')],
    ['addTaskDependency', () => addTaskDependency('p1', 'i1', 'i2', 'FS', 0)],
  ] as const)('%s: 거부', async (_name, run) => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await run()
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(createServerClient).not.toHaveBeenCalled()
    expect(requireProjectAdmin).toHaveBeenCalledWith('p1')
  })

  it('updateWeight: 가중치 형식 검증은 가드보다 먼저 — 잘못된 값은 가드 호출 없이 거부', async () => {
    expect(await updateWeight('i1', -1)).toEqual({ ok: false, error: '가중치는 0 이상이어야 함' })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('projectId 를 인자로 받는 액션은 resolveProjectId 를 쓰지 않는다', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    await addWbsItem('p1', null, '신규')
    await addTaskDependency('p1', 'i1', 'i2', 'FS', 0)
    expect(resolveProjectId).not.toHaveBeenCalled()
  })

  it('대상 행에서 project_id 를 읽는 액션은 그 값으로 판정한다', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p9' })
    await deleteWbsItem('i1')
    expect(resolveProjectId).toHaveBeenCalledWith('wbs_items', 'i1')
    expect(requireProjectAdmin).toHaveBeenCalledWith('p9')

    resolveProjectId.mockClear()
    await removeTaskDependency('d1')
    expect(resolveProjectId).toHaveBeenCalledWith('task_dependencies', 'd1')
  })
})

describe('resolveProjectId 실패 — 판정 불가는 쓰기 중단(가드도 부르지 않는다)', () => {
  it.each([
    ['조회 실패', LOOKUP_FAILED],
    ['대상 없음', MISSING],
  ] as const)('updateActual: %s → 그 문구로 중단', async (_name, failure) => {
    resolveProjectId.mockResolvedValue(failure)
    expect(await updateActual('i1', 50)).toEqual({ ok: false, error: failure.error })
    expect(requireProjectMember).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('updateWeight: 조회 실패 → 중단', async () => {
    resolveProjectId.mockResolvedValue(LOOKUP_FAILED)
    expect(await updateWeight('i1', 3)).toEqual({ ok: false, error: LOOKUP_FAILED.error })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('프로젝트 액션', () => {
  it('createProject: 슈퍼유저 아니면 throw + DB 무접근', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    await expect(createProject('신규', null, null)).rejects.toThrow('권한 없음')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it.each([
    ['updateProject', () => updateProject('p1', { name: '이름' })],
    ['setBaseDate', () => setBaseDate('p1', '2026-07-30')],
  ] as const)('%s: 관리자 아니면 ok:false + DB 무접근', async (_name, run) => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await run()).toEqual({ ok: false, error: '권한 없음' })
    expect(createServerClient).not.toHaveBeenCalled()
    expect(requireProjectAdmin).toHaveBeenCalledWith('p1')
  })

  it.each([
    ['addHoliday', () => addHoliday('p1', '2026-08-15', '광복절')],
    ['removeHoliday', () => removeHoliday('p1', '2026-08-15')],
  ] as const)('%s: 관리자 아니면 throw + DB 무접근', async (_name, run) => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    await expect(run()).rejects.toThrow('권한 없음')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('getChangeLogs: 비로그인은 DB 조회 없이 빈 목록', async () => {
    getSession.mockResolvedValue(null)
    expect(await getChangeLogs('i1')).toEqual([])
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('임포트 라우트 — 본문 projectId 로 관리자 판정, 상태코드 유지', () => {
  function reqWith(fields: Record<string, string | Blob>) {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return { formData: async () => form } as unknown as Parameters<typeof IMPORT_POST>[0]
  }
  const FILE = new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  it('권한 없음 → 403', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await IMPORT_POST(reqWith({ file: FILE, projectId: 'p1' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: '권한 없음' })
    expect(requireProjectAdmin).toHaveBeenCalledWith('p1')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('비로그인 → 401', async () => {
    requireProjectAdmin.mockResolvedValue(ANON)
    const res = await IMPORT_POST(reqWith({ file: FILE, projectId: 'p1' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '로그인 필요' })
  })

  it('권한 조회 실패 → 500(거부가 아니라 서버 사정)', async () => {
    requireProjectAdmin.mockResolvedValue(LOOKUP_FAILED)
    const res = await IMPORT_POST(reqWith({ file: FILE, projectId: 'p1' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: LOOKUP_FAILED.error })
  })

  it('projectId 누락 → 400, 가드 호출 없음', async () => {
    const res = await IMPORT_POST(reqWith({ file: FILE }))
    expect(res.status).toBe(400)
    expect(requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('가드 통과 시 비로소 DB 로 간다', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
    state.client = { rpc: vi.fn(async () => ({ data: 0, error: null })) }
    const res = await IMPORT_POST(reqWith({ file: FILE, projectId: 'p1' }))
    expect(res.status).toBe(200)
    expect(createServerClient).toHaveBeenCalled()
  })
})
