import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  activeTeamCodes: ['PMO', 'ERP', 'MES', '가공', 'MDM'] as string[],
  // Task 6 — 프로젝트 스코프 활성 팀 목록. 기본 구현은 beforeEach 에서 건다(초기화 시점에
  // mocks.activeTeamCodes 를 참조하면 자기 참조로 TS 순환 추론 에러가 난다).
  activeTeamCodesForProject: vi.fn<(projectId: string) => string[]>(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/teams/master', () => ({
  activeTeamCodesSync: () => mocks.activeTeamCodes,
  activeTeamCodesForProjectSync: (projectId: string) => mocks.activeTeamCodesForProject(projectId),
}))

import { DELETE, GET, POST } from '@/app/api/v1/minutes/folder/route'

const SECRET = 'test-minutes-secret'
const USER = { id: 'u-1', email: 'jerry@example.com', user_metadata: { full_name: '팀장' } }
const EID = (n: number) => `ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b${String(n).padStart(2, '0')}`

type QueryResponse = { data?: unknown; error?: { message?: string; code?: string } | null }

function queryBuilder(response: QueryResponse) {
  const b: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (r: (v: unknown) => unknown, j: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'in', 'limit', 'maybeSingle', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve, reject) =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null }).then(resolve, reject)
  return b
}

/** 테이블별 응답 큐 — from(table) 호출 순서대로 소비. */
function useAdmin(tables: Record<string, QueryResponse[]> = {}, users = [USER]) {
  const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
  // 배치는 관리자 이상 전용(결정 §2-H). 판정 축이 memberships.role → is_superuser +
  // project_roles 로 바뀌었으므로(0052/0054) 기본값도 새 축으로 깐다 — 명시하지 않으면 슈퍼유저.
  const roleQueue = tables.memberships ?? [{ data: { is_superuser: true } }]
  const admin = {
    from: vi.fn((table: string) => {
      const queued = table === 'memberships'
        ? (roleQueue.shift() ?? { data: { is_superuser: true } })
        : ((tables[table] ?? []).shift() ?? { data: null, error: null })
      const b = queryBuilder(queued)
      ;(builders[table] ??= []).push(b)
      return b
    }),
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, builders }
}

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/minutes/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}`, ...headers },
    body: JSON.stringify(body),
  })
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const SEED_MES = { id: 'f-mes', name: 'MES', parent_id: null, created_by: null }
const SEED_ERP = { id: 'f-erp', name: 'ERP', parent_id: null, created_by: null }
const F_QUALITY = { id: 'f-q', name: '품질', parent_id: 'f-mes', created_by: 'u-9' }
const F_WEEKLY = { id: 'f-w', name: '주간정례', parent_id: 'f-q', created_by: 'u-9' }
const TREE = [SEED_MES, SEED_ERP, F_QUALITY, F_WEEKLY]

/** minutes 행 — 배치가 조회하는 컬럼만. project_id 기본 null(전역 트리, 기존 동작). */
const minute = (n: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `m-${n}`, external_id: EID(n), team_code: 'MES', project_id: null,
  folder_id: 'f-mes', archived_at: null, ...over,
})

/** 폴더 스냅샷 + 대상 회의록 조회 응답을 세팅한다(배치의 고정 선두 2질의). */
function useBatch(rows: Array<Record<string, unknown>>, extraMinutes: QueryResponse[] = []) {
  return useAdmin({
    minute_folders: [{ data: TREE }],
    minutes: [{ data: rows }, ...extraMinutes],
  })
}

const body = (over: Record<string, unknown> = {}) => ({
  user_email: 'jerry@example.com', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공', 'MDM']
  // clearAllMocks 는 mockImplementation 을 지우지 않는다 — 개별 테스트의 override 가 다음
  // 테스트로 새지 않도록 기본 구현을 매번 다시 건다.
  mocks.activeTeamCodesForProject.mockImplementation(() => mocks.activeTeamCodes)
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  vi.stubEnv('MINUTES_API_SECRET', SECRET)
  useAdmin()
})

describe('게이트·봉투 검증 (§4c)', () => {
  it('플래그 미설정이면 404 — 존재 은닉, DB 미접근', async () => {
    vi.stubEnv('MINUTES_API_ENABLED', 'false')
    expect((await POST(post(body({ items: [] })))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('시크릿 불일치는 401', async () => {
    const req = new NextRequest('http://localhost/api/v1/minutes/folder', {
      method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}',
    })
    expect((await POST(req)).status).toBe(401)
  })

  it('미정의 메서드는 404', async () => {
    expect((await GET()).status).toBe(404)
    expect((await DELETE()).status).toBe(404)
  })

  it('user_email 이 없으면 400', async () => {
    expect((await POST(post({ items: [] }))).status).toBe(400)
  })

  it('items 가 배열이 아니면 400', async () => {
    expect((await POST(post(body({ items: 'x' })))).status).toBe(400)
  })

  it('201건이면 400 (상한 200)', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ external_id: EID(i), folder_path: [] }))
    const res = await POST(post(body({ items })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('200')
  })

  it('200건은 통과한다(경계)', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ external_id: EID(i), folder_path: [] }))
    useBatch([])
    expect((await POST(post(body({ items })))).status).toBe(200)
  })

  it('dry_run·overwrite_manual 이 boolean 이 아니면 400', async () => {
    expect((await POST(post(body({ dry_run: 'yes', items: [] })))).status).toBe(400)
    expect((await POST(post(body({ overwrite_manual: 1, items: [] })))).status).toBe(400)
  })
})

describe('ACTOR_EMAIL 프로브 (요건 9 · 게이트 순서)', () => {
  it('items: [] + dry_run 은 200 OK + 전 카운트 0 — 400 이 아니다', async () => {
    const { admin } = useAdmin()
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true, dry_run: true,
      summary: { total: 0, moved: 0, already_correct: 0, skipped: 0, not_found: 0, failed: 0 },
      results: [],
    })
    // 권한 게이트(memberships) 외에는 아무것도 건드리지 않는다 — 폴더·회의록 조회 0
    // 슈퍼유저면 project_roles 까지 갈 필요가 없다(단축 판정).
    const touched = admin.from.mock.calls.map(c => c[0])
    expect(touched).toEqual(['memberships'])
  })

  it('관리자가 아니면 403 forbidden_role — ACTOR_EMAIL 오타를 첫 프로브에서 잡는다(§2-H)', async () => {
    // 슈퍼유저 아님 + 어느 프로젝트에도 admin 역할 없음
    useAdmin({ memberships: [{ data: { is_superuser: false } }], project_roles: [{ data: [] }] })
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
  })

  it('권한 조회 실패는 fail-closed(403) — 보안 가드는 통과시키지 않는다', async () => {
    useAdmin({ memberships: [{ data: null, error: { message: 'down' } }] })
    expect((await POST(post(body({ items: [] })))).status).toBe(403)
  })

  it('프로젝트 역할 조회 실패도 fail-closed(403)', async () => {
    useAdmin({
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: null, error: { message: 'down' } }],
    })
    expect((await POST(post(body({ items: [] })))).status).toBe(403)
  })

  it('어느 프로젝트든 관리자면 통과한다 — 슈퍼유저가 아니어도', async () => {
    useAdmin({
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ project_id: 'p1' }] }],
    })
    expect((await POST(post(body({ dry_run: true, items: [] })))).status).toBe(200)
  })

  it('권한 게이트는 실제 이동 요청도 막는다 — 폴더·회의록 조회 이전에', async () => {
    const { admin } = useAdmin({
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [] }],
      minute_folders: [{ data: TREE }],
      minutes: [{ data: [minute(1)] }],
    })
    const res = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect(res.status).toBe(403)
    expect(admin.from.mock.calls.map(c => c[0])).toEqual(['memberships', 'project_roles'])
  })

  it("D'Flow 에 없는 user_email + items: [] 는 403 — 계정 게이트가 페이로드 검증보다 먼저", async () => {
    useAdmin({}, [])
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('unknown_user')
  })

  it('계정 게이트는 봉투 오류(items 누락)보다도 먼저다', async () => {
    useAdmin({}, [])
    expect((await POST(post(body({}))))?.status).toBe(403)
  })
})

describe('dry run 기본값 (요건 8)', () => {
  it('dry_run 필드 없이 호출하면 아무것도 이동하지 않는다', async () => {
    const { builders } = useBatch([minute(1)])
    const res = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    const json = await res.json()
    expect(json.dry_run).toBe(true)
    expect(json.summary).toMatchObject({ total: 1, moved: 1 })
    // minutes 는 대상 조회 1회뿐 — update 없음
    expect(builders.minutes).toHaveLength(1)
    expect(builders.minutes[0].update).not.toHaveBeenCalled()
  })

  it('dry run 은 폴더도 만들지 않는다 — 없는 경로는 folder_id: null 로 보고', async () => {
    const { builders } = useBatch([minute(1)])
    const res = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '신규', '킥오프'] }],
    })))
    const json = await res.json()
    expect(json.results[0]).toMatchObject({
      status: 'moved', to: ['MES', '신규', '킥오프'], folder_id: null,
    })
    expect(builders.minute_folders).toHaveLength(1)     // 스냅샷 1회, insert 0
  })
})

describe('판정 (§8.3 · 요건 6·10)', () => {
  it('이미 목표 위치면 already_correct — moved 에 섞지 않는다', async () => {
    useBatch([minute(1, { folder_id: 'f-q' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'already_correct', folder_id: 'f-q' })
    expect(json.summary).toMatchObject({ moved: 0, already_correct: 1, skipped: 0 })
  })

  it('already_correct 가 manual_placement 판정보다 먼저다 — APPLY 후 재실행 dry-run 회귀', async () => {
    // 1차 APPLY 로 f-w(3단)에 옮긴 건. folder_id 만 보면 하위 폴더라 manual_placement 로 보인다.
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질', '주간정례'] }],
    })))
    const json = await r.json()
    expect(json.results[0].status).toBe('already_correct')
    expect(json.summary.skipped).toBe(0)               // 판단 근거가 오염되면 안 된다
  })

  it('팀 루트에 있고 목표도 팀 루트면 already_correct (moved 아님)', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: [] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'already_correct', folder_id: 'f-mes' })
  })

  it('미분류(folder_id null)는 이동한다', async () => {
    useBatch([minute(1, { folder_id: null })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', from: null, to: ['MES', '품질'] })
  })

  it('팀 루트(자동 편철 자리)에 있으면 이동한다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'moved', from: ['MES'], to: ['MES', '품질'], folder_id: 'f-q',
    })
  })

  it('하위 폴더에 있고 목표와 다르면 skipped(manual_placement)', async () => {
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'skipped', reason: 'manual_placement', from: ['MES', '품질', '주간정례'],
    })
  })

  it('overwrite_manual: true 면 그것도 이동한다', async () => {
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({
      overwrite_manual: true,
      items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q' })
  })
})

describe('건별 실패 사유 (요건 11 status 값 집합)', () => {
  it('없는 external_id 는 not_found', async () => {
    useBatch([])
    const r = await POST(post(body({ items: [{ external_id: EID(9), folder_path: [] }] })))
    expect((await r.json()).results[0]).toEqual({ external_id: EID(9), status: 'not_found' })
  })

  it('archived 는 skipped(archived)', async () => {
    useBatch([minute(1, { archived_at: '2026-07-20T00:00:00+00:00' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: [] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'archived' })
  })

  it('items[].team 이 기존 team_code 와 다르면 failed(team_mismatch) — 이동 안 됨', async () => {
    const { builders } = useBatch([minute(1)])
    const r = await POST(post(body({
      dry_run: false,
      items: [{ external_id: EID(1), team: 'ERP', folder_path: ['ERP'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'failed', reason: 'team_mismatch' })
    expect(builders.minutes).toHaveLength(1)           // update 없음
  })

  it('items[].team 생략은 기존 team_code 로 편철된다', async () => {
    useBatch([minute(1, { folder_id: null })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['품질'] }] })))
    // team=MES 로 판정 → 자유 루트 '품질'이 한 칸 내려 MES/품질
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', to: ['MES', '품질'] })
  })

  it('61자 폴더명은 failed(folder_name_too_long)', async () => {
    useBatch([minute(1)])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '가'.repeat(61)] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'failed', reason: `folder_name_too_long: ${'가'.repeat(61)}(61자)`,
    })
  })

  it('타 팀 루트는 failed(validation_failed)', async () => {
    useBatch([minute(1)])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['ERP', '영업'] }] })))
    expect((await r.json()).results[0].reason).toContain('validation_failed')
  })

  it('시드 루트 부재는 failed(no_team_root) — folder_id 를 건드리지 않고 moved 로 집계하지 않는다', async () => {
    // 스냅샷에 가공 팀 루트가 없다
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }],
      minutes: [{ data: [minute(1, { team_code: '가공', folder_id: 'f-mes' })] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['가공', '품질'] }],
    })))
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'failed', reason: 'no_team_root' })
    expect(json.results[0].folder_id).toBeUndefined()  // 이동하지 않았음을 형태로 드러낸다
    expect(json.summary).toMatchObject({ moved: 0, failed: 1 })
    expect(builders.minutes).toHaveLength(1)           // update 없음
  })

  it('부분 실패는 전체를 롤백하지 않는다 — 건별 results 로 보고', async () => {
    useBatch([minute(1, { folder_id: null }), minute(2, { archived_at: 'x' })])
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: ['MES', '품질'] },
        { external_id: EID(2), folder_path: ['MES', '품질'] },
        { external_id: EID(3), folder_path: ['MES', '품질'] },
      ],
    })))
    const json = await r.json()
    expect(json.summary).toEqual({
      total: 3, moved: 1, already_correct: 0, skipped: 1, not_found: 1, failed: 0,
    })
  })
})

describe('APPLY 실행 (요건 2·3)', () => {
  it('folder_id 만 갱신한다 — updated_at 을 건드리지 않는다', async () => {
    const { builders } = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q' })
    expect(builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-q' })
    expect(builders.minutes[1].update).not.toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.anything() }),
    )
  })

  it('버전 append 없음 — commit_minute_body_version 을 경유하지 않는다', async () => {
    const { admin } = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    // 가짜 클라이언트에 rpc 가 아예 없다 — 라우트가 RPC 를 부르면 TypeError 로 즉시 실패한다.
    expect(admin).not.toHaveProperty('rpc')
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0].status).toBe('moved')
  })

  it('APPLY 는 부족한 폴더를 만들고 created_by 에 실행 계정을 넣는다(C4)', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }, { data: { id: 'f-new' } }],
      minutes: [{ data: [minute(1)] }, { data: [{ id: 'm-1' }] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'moved', folder_id: 'f-new', to: ['MES', '신규'],
    })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: '신규', parent_id: 'f-mes', created_by: 'u-1', project_id: null,
    })
  })

  it('APPLY 중 폴더 생성 실패는 failed(folder_error) — 조상에 떨구고 moved 로 위장하지 않는다', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }, { data: null, error: { code: '42501', message: 'denied' } }],
      minutes: [{ data: [minute(1)] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'failed' })
    expect(json.results[0].reason).toContain('folder_error')
    expect(builders.minutes).toHaveLength(1)           // update 없음
  })

  it('update 가 0행이면 failed — 조용한 no-op 을 성공으로 위장하지 않는다', async () => {
    useBatch([minute(1)], [{ data: [] }])
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'failed' })
  })

  it('멱등 — 같은 요청을 두 번 실행하면 두 번째는 already_correct', async () => {
    useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const first = await (await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))).json()
    expect(first.summary).toMatchObject({ moved: 1 })

    useBatch([minute(1, { folder_id: 'f-q' })])
    const second = await (await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))).json()
    expect(second.summary).toMatchObject({ moved: 0, already_correct: 1 })
  })

  it('같은 external_id 가 한 요청에 두 번 오면 두 번째는 already_correct', async () => {
    useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const r = await POST(post(body({
      dry_run: false,
      items: [
        { external_id: EID(1), folder_path: ['MES', '품질'] },
        { external_id: EID(1), folder_path: ['MES', '품질'] },
      ],
    })))
    const json = await r.json()
    expect(json.summary).toMatchObject({ moved: 1, already_correct: 1 })
  })
})

describe('조상 규칙 (§4c.5 · 결정 §2-J)', () => {
  it('현재 위치가 목표의 조상이면 이동 — 더 깊게 넣는 것은 사람의 정리를 훼손하지 않는다', async () => {
    // 현재 MES/품질, 목표 MES/품질/주간정례 → 조상이므로 이동
    useBatch([minute(1, { folder_id: 'f-q' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질', '주간정례'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'moved', from: ['MES', '품질'], to: ['MES', '품질', '주간정례'],
    })
  })

  it('얕은 쪽으로 되돌리는 이동은 skip — 배치가 트리를 평평하게 만들지 않는다', async () => {
    // 현재 MES/품질/주간정례, 목표 MES/품질 → 조상이 아니라 자손이다
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'manual_placement' })
  })

  it('다른 가지로 옮겨 둔 건은 계속 보호된다', async () => {
    const tree = [...TREE, { id: 'f-etc', name: '기타', parent_id: 'f-mes', created_by: 'u-9' }]
    useAdmin({
      minute_folders: [{ data: tree }],
      minutes: [{ data: [minute(1, { folder_id: 'f-etc' })] }],
    })
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'manual_placement' })
  })

  it('팀 루트는 조상 규칙의 특수 케이스로 흡수된다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질', '주간정례'] }],
    })))
    expect((await r.json()).results[0].status).toBe('moved')
  })
})

describe('건별 검증 실패 (계약 v2.4 ⑥ — 요청 전체 400 금지)', () => {
  it('folder_path 타입 오류는 그 건만 failed, 나머지는 정상 처리된다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' }), minute(2, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: 'MES/품질' },        // 타입 오류
        { external_id: EID(2), folder_path: ['MES', '품질'] },   // 정상
      ],
    })))
    expect(r.status).toBe(200)                                   // 400 이 아니다
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'failed' })
    expect(json.results[0].reason).toContain('validation_failed')
    expect(json.results[1].status).toBe('moved')
    expect(json.summary).toMatchObject({ total: 2, moved: 1, failed: 1 })
  })

  it('60자 초과도 건별 failed', async () => {
    useBatch([minute(1), minute(2, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: ['MES', '가'.repeat(61)] },
        { external_id: EID(2), folder_path: ['MES', '품질'] },
      ],
    })))
    const json = await r.json()
    expect(json.results[0].reason).toContain('folder_name_too_long')
    expect(json.results[1].status).toBe('moved')
  })
})

describe('폴더 생성 시점 — 판정 전에 만들지 않는다(리뷰 지적)', () => {
  it('APPLY 에서 skip 될 건의 목표 트리를 미리 만들지 않는다 — 빈 고아 폴더 방지', async () => {
    // 현재 MES/기타(다른 가지) → 목표 MES/품질/신규. 조상이 아니라 skip 되어야 하고,
    // 그 과정에서 '신규' 폴더가 만들어지면 아무도 안 쓰는 ACTOR 명의 폴더가 트리에 남는다.
    const tree = [...TREE, { id: 'f-etc', name: '기타', parent_id: 'f-mes', created_by: 'u-9' }]
    const { builders } = useAdmin({
      minute_folders: [{ data: tree }],
      minutes: [{ data: [minute(1, { folder_id: 'f-etc' })] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'manual_placement' })
    // 스냅샷 조회 1회뿐 — insert 가 한 번도 일어나지 않았다
    expect(builders.minute_folders).toHaveLength(1)
  })

  it('이동이 확정된 건에 대해서는 APPLY 가 폴더를 만든다', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }, { data: { id: 'f-new' } }],
      minutes: [{ data: [minute(1, { folder_id: 'f-q' })] }, { data: [{ id: 'm-1' }] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-new' })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '신규', parent_id: 'f-q', created_by: 'u-1' }),
    )
  })
})

describe('folder_path_status (결정 §2-C)', () => {
  it('정상 편철은 exact', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0].folder_path_status).toBe('exact')
  })

  it('한 칸 내림도 exact — 정상 동작이지 품질 저하가 아니다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['자유루트'] }] })))
    const res = (await r.json()).results[0]
    expect(res.to).toEqual(['MES', '자유루트'])
    expect(res.folder_path_status).toBe('exact')
  })

  it('깊이 5 초과 절단은 truncated — 침묵하면 APPLY 후 영영 already_correct 가 된다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', 'A', 'B', 'C', 'D', 'E'] }],
    })))
    const res = (await r.json()).results[0]
    expect(res.to).toHaveLength(5)
    expect(res.folder_path_status).toBe('truncated')
  })

  it('APPLY 중 생성 실패는 partial 이 아니라 failed 로 막는다(리포트와 트리 불일치 방지)', async () => {
    useAdmin({
      minute_folders: [{ data: TREE }, { data: null, error: { code: '42501', message: 'denied' } }],
      minutes: [{ data: [minute(1, { folder_id: 'f-mes' })] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    expect((await r.json()).results[0].status).toBe('failed')
  })
})

describe('summary 항등식 (§4c.2 응답 계약)', () => {
  it('total = moved + already_correct + skipped + not_found + failed — 혼합 케이스', async () => {
    useAdmin({
      minute_folders: [{ data: TREE }],
      minutes: [{ data: [
        minute(1, { folder_id: 'f-mes' }),                       // → moved
        minute(2, { folder_id: 'f-q' }),                         // → already_correct
        minute(3, { folder_id: 'f-w' }),                         // → skipped(manual_placement)
        minute(4, { folder_id: 'f-mes', archived_at: 'x' }),     // → skipped(archived)
        minute(5, { folder_id: 'f-mes' }),                       // → failed(team_mismatch)
      ] }],
    })
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: ['MES', '품질'] },
        { external_id: EID(2), folder_path: ['MES', '품질'] },
        { external_id: EID(3), folder_path: ['MES', '품질'] },
        { external_id: EID(4), folder_path: ['MES', '품질'] },
        { external_id: EID(5), team: 'ERP', folder_path: ['MES', '품질'] },
        { external_id: EID(9), folder_path: ['MES', '품질'] },   // → not_found
      ],
    })))
    const json = await r.json()
    const s = json.summary
    expect(s.total).toBe(6)
    expect(s.moved + s.already_correct + s.skipped + s.not_found + s.failed).toBe(s.total)
    expect(s).toEqual({ total: 6, moved: 1, already_correct: 1, skipped: 2, not_found: 1, failed: 1 })
    // results 는 요청 items 순서를 보존한다 — 또박또박이 인덱스로 대조한다
    expect(json.results.map((x: { status: string }) => x.status)).toEqual(
      ['moved', 'already_correct', 'skipped', 'skipped', 'failed', 'not_found'],
    )
  })
})

describe('비활성 팀 시나리오 (§3.2 ① 단독 조건)', () => {
  it('team_code 가 비활성이어도 루트 세그먼트가 중복되지 않는다', async () => {
    mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공']        // MDM 비활성
    useAdmin({
      minute_folders: [{ data: [...TREE, { id: 'f-mdm', name: 'MDM', parent_id: null, created_by: null }] }],
      minutes: [{ data: [minute(1, { team_code: 'MDM', folder_id: 'f-mdm' })] }],
    })
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MDM', '품질'] }],
    })))
    // ①이 캐시를 봤다면 ②로 떨어져 ["MDM","MDM","품질"]가 된다
    expect((await r.json()).results[0].to).toEqual(['MDM', '품질'])
  })
})

describe('편철 기준 트리 — 회의록 프로젝트 스코프 (0076 · Task 6)', () => {
  const PROJECT_UUID = '90b95d7d-8d5c-4f8c-9915-4a07b876af27'
  // 같은 이름 'MES' 루트가 전역(f-mes)과 프로젝트(f-mes-p)에 각각 존재 — 스코프를 안 가리면
  // 전역 루트와 뒤섞인다.
  const SEED_MES_PROJECT = { id: 'f-mes-p', name: 'MES', parent_id: null, created_by: null, project_id: PROJECT_UUID }
  const TREE_WITH_PROJECT = [...TREE, SEED_MES_PROJECT]

  it('회의록의 project_id 스코프 루트를 기준으로 판정한다 — 전역 루트와 혼동하지 않는다', async () => {
    useAdmin({
      minute_folders: [{ data: TREE_WITH_PROJECT }],
      minutes: [{ data: [minute(1, { project_id: PROJECT_UUID, folder_id: 'f-mes-p' })] }],
    })
    // 목표는 팀 루트([]) — 전역 스코프로 해석하면 f-mes 가 되어 row.folder_id(f-mes-p)와
    // 어긋나 manual_placement 로 skip 된다. 프로젝트 스코프로 바르게 해석하면 already_correct.
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: [] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'already_correct', folder_id: 'f-mes-p' })
  })

  it('APPLY 도 회의록의 프로젝트 트리 안에서 폴더를 만든다', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE_WITH_PROJECT }, { data: { id: 'f-new-p' } }],
      minutes: [
        { data: [minute(1, { project_id: PROJECT_UUID, folder_id: 'f-mes-p' })] },
        { data: [{ id: 'm-1' }] },
      ],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-new-p' })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: '신규', parent_id: 'f-mes-p', created_by: 'u-1', project_id: PROJECT_UUID,
    })
  })

  it('활성 팀 목록도 회의록의 프로젝트 스코프로 조회한다', async () => {
    mocks.activeTeamCodesForProject.mockImplementation((projectId: string) =>
      projectId === PROJECT_UUID ? ['PMO', 'ERP', 'MES', '가공', 'MDM', '신설팀'] : mocks.activeTeamCodes)
    const tree = [...TREE_WITH_PROJECT, {
      id: 'f-newteam-p', name: '신설팀', parent_id: null, created_by: null, project_id: PROJECT_UUID,
    }]
    useAdmin({
      minute_folders: [{ data: tree }],
      minutes: [{ data: [minute(1, {
        project_id: PROJECT_UUID, team_code: '신설팀', folder_id: 'f-newteam-p',
      })] }],
    })
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['신설팀', '품질'] }],
    })))
    const json = await r.json()
    // 전역 activeTeamCodes 만 봤다면 '신설팀'이 활성 팀 아님 취급되어 한 칸 내려 중복된다
    // (["신설팀","신설팀","품질"]).
    expect(json.results[0].to).toEqual(['신설팀', '품질'])
    expect(mocks.activeTeamCodesForProject).toHaveBeenCalledWith(PROJECT_UUID)
  })
})
