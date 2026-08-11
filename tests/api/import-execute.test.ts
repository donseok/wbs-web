import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LEGACY_DCUBE_PROFILE } from '@/lib/excel/profile'

// 라우트 mock 관례(tests/api/import-inspect.test.ts, tests/actions/authz-gate-wbs.test.ts 참고) —
// 가드·파서·팀 마스터·DB 클라이언트를 각각 mock 해 라우트의 배선(순서·상태코드·에러 위장 금지)만 검증한다.
// validateProfile 은 실물(mock 아님) — 프로파일 검증 배선까지 통합적으로 확인(Task5 관례 계승).
const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireSuperuser: vi.fn(),
  parseWithProfile: vi.fn(),
  linkByDepth: vi.fn(),
  resolveLegacyLevelLabels: vi.fn(),
  splitLeafOwners: vi.fn(),
  projectTeamRowsSync: vi.fn(),
  teamsForProjectSync: vi.fn(),
  addTeam: vi.fn(),
  addProjectTeam: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(),
  ingestProject: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin, requireSuperuser: mocks.requireSuperuser,
}))
vi.mock('@/lib/excel/parseWithProfile', () => ({
  parseWithProfile: mocks.parseWithProfile,
  linkByDepth: mocks.linkByDepth,
  resolveLegacyLevelLabels: mocks.resolveLegacyLevelLabels,
}))
vi.mock('@/lib/excel/validate', () => ({ splitLeafOwners: mocks.splitLeafOwners }))
vi.mock('@/lib/teams/master', () => ({
  projectTeamRowsSync: mocks.projectTeamRowsSync, teamsForProjectSync: mocks.teamsForProjectSync,
}))
vi.mock('@/app/actions/teams', () => ({ addTeam: mocks.addTeam }))
vi.mock('@/app/actions/projectTeams', () => ({ addProjectTeam: mocks.addProjectTeam }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: mocks.ingestProject }))

import { POST } from '@/app/api/import/execute/route'

// UUID 형식 픽스처(agent-loop 교훈 — 'p1' 같은 비-UUID 를 쓰지 않는다).
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR = { userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map() }
const SUPER_ACTOR = { userId: 'su1', teamCode: null, teamId: null, isSuperuser: true, projectRoles: new Map() }
const FILE = new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
const KNOWN_TEAMS = [{ code: 'PMO' }, { code: 'ERP' }, { code: 'MES' }, { code: '가공' }, { code: 'MDM' }]

const ROW_PMO = {
  depth: 0, code: null, name: 'x', extraAxis: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [{ team: 'PMO', kind: 'primary' as const }], excelRow: 4,
}
const ROW_UNKNOWN_TEAM = { ...ROW_PMO, owners: [{ team: 'NEWTEAM', kind: 'primary' as const }] }
const LINKED_ITEM = {
  tempId: 't0', parentTempId: null, level: 'activity' as const, code: '1', sortOrder: 0,
  name: 'x', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [{ team: 'PMO', kind: 'primary' as const }], isOwnerSplit: false,
}

function req(fields: Record<string, string | Blob>): Parameters<typeof POST>[0] {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0]
}

function baseFields(overrides: Record<string, string | Blob> = {}) {
  return {
    file: FILE,
    projectId: PROJECT_ID,
    profile: JSON.stringify(LEGACY_DCUBE_PROFILE),
    mode: 'append',
    saveProfile: 'false',
    registerTeams: 'false',
    ...overrides,
  }
}

/** wbs_items 백업 select 체인(select().eq()) 만 지원하는 최소 thenable 빌더. */
function backupBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(response).then(resolve, reject)
  return builder
}

function makeSbClient(opts: {
  backup?: { data: unknown; error: unknown }
  rpc?: { data: unknown; error: unknown }
} = {}) {
  const builder = backupBuilder(opts.backup ?? { data: [], error: null })
  const from = vi.fn((table: string) => {
    if (table === 'wbs_items') return builder
    throw new Error(`unexpected table: ${table}`)
  })
  const rpc = vi.fn(async () => opts.rpc ?? { data: 5, error: null })
  return { from, rpc }
}

function makeAdminClient(opts: { upsertError?: { message: string } | null } = {}) {
  const upsert = vi.fn(async () => ({ error: opts.upsertError ?? null }))
  const from = vi.fn((table: string) => {
    if (table === 'project_settings') return { upsert }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from, upsert }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
  mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_PMO], holidays: [] })
  mocks.resolveLegacyLevelLabels.mockReturnValue(true)
  mocks.linkByDepth.mockReturnValue({ ok: true, items: [LINKED_ITEM] })
  mocks.splitLeafOwners.mockImplementation((items: unknown) => items)
  // 기본: projectTeamRowsSync 빈 배열 = 전역 상속 프로젝트(D-CUBE 동치) — 기존 동작을 보존한다.
  mocks.projectTeamRowsSync.mockReturnValue([])
  mocks.teamsForProjectSync.mockReturnValue(KNOWN_TEAMS)
  mocks.addTeam.mockResolvedValue({ ok: true })
  mocks.addProjectTeam.mockResolvedValue({ ok: true })
  mocks.recordProgressSnapshot.mockResolvedValue(undefined)
  mocks.ingestProject.mockResolvedValue({ count: 3 })
  mocks.createServerClient.mockImplementation(async () => makeSbClient())
  mocks.createAdminClient.mockImplementation(() => makeAdminClient())
})

describe('POST /api/import/execute — 입력 검증(가드 이전)', () => {
  it.each([
    ['file 누락', { projectId: PROJECT_ID, profile: '{}', mode: 'append' }],
    ['projectId 누락', { file: FILE, profile: '{}', mode: 'append' }],
    ['profile 누락', { file: FILE, projectId: PROJECT_ID, mode: 'append' }],
  ] as const)('%s → 400, 가드 호출 없음', async (_name, fields) => {
    const res = await POST(req(fields as Record<string, string | Blob>))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('mode 가 append/replace 가 아니면 400, 가드 호출 없음', async () => {
    const res = await POST(req(baseFields({ mode: 'delete' })))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('비 UUID projectId → 400, 가드 호출 없음', async () => {
    const res = await POST(req(baseFields({ projectId: 'p1' })))
    expect(res.status).toBe(400)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — 가드', () => {
  it('미인가(관리자 아님) → 403, 파서 미호출', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: '권한 없음' })
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('비로그인 → 401', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(401)
  })

  it('권한 조회 실패 → 500(거부가 아니라 서버 사정)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/import/execute — 검증 오류 400', () => {
  it('프로파일이 스키마를 위반하면 400, parseWithProfile 미호출', async () => {
    const res = await POST(req(baseFields({ profile: JSON.stringify({ version: 2 }) })))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('version')
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('프로파일이 JSON 파싱조차 안 되면 400', async () => {
    const res = await POST(req(baseFields({ profile: 'not-json' })))
    expect(res.status).toBe(400)
    expect(mocks.parseWithProfile).not.toHaveBeenCalled()
  })

  it('parseWithProfile 실패 → 그 에러 문자열 그대로 400, 팀 검증 이후 단계 미호출', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: false, error: '시트를 찾을 수 없습니다: WBS' })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '시트를 찾을 수 없습니다: WBS' })
    expect(mocks.teamsForProjectSync).not.toHaveBeenCalled()
  })

  it('linkByDepth 구조 오류 → errors 배열 그대로 400', async () => {
    mocks.linkByDepth.mockReturnValue({ ok: false, errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
  })

  it('미등록 팀 포함 + linkByDepth 구조 오류 → 팀 부트스트랩 전에 400, 팀 대조·등록 전부 미호출(리뷰 Minor — 검증 실패 요청은 팀 마스터에 부수효과를 남기지 않는다)', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    mocks.linkByDepth.mockReturnValue({ ok: false, errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ errors: [{ excelRow: 5, message: '깊이 건너뜀' }] })
    expect(mocks.projectTeamRowsSync).not.toHaveBeenCalled()
    expect(mocks.teamsForProjectSync).not.toHaveBeenCalled()
    expect(mocks.requireSuperuser).not.toHaveBeenCalled()
    expect(mocks.addTeam).not.toHaveBeenCalled()
    expect(mocks.addProjectTeam).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — 팀 부트스트랩(§10.3, 전역 상속 프로젝트 — projectTeamRowsSync 빈 배열)', () => {
  it('미등록 팀 + registerTeams=false → 409 needsTeams scope:global, DB 무접근', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ needsTeams: ['NEWTEAM'], scope: 'global' })
    expect(mocks.requireSuperuser).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('미등록 팀 + registerTeams=true + 비슈퍼유저 → 403, addTeam·addProjectTeam 미호출', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: '팀 등록은 슈퍼유저 권한' })
    expect(mocks.addTeam).not.toHaveBeenCalled()
    expect(mocks.addProjectTeam).not.toHaveBeenCalled()
  })

  it('미등록 팀 + registerTeams=true + 슈퍼유저 → addTeam(전역) 호출 후 임포트 성공, addProjectTeam 미호출', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: SUPER_ACTOR })
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(mocks.addTeam).toHaveBeenCalledWith('NEWTEAM')
    expect(mocks.addProjectTeam).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.count).toBe(5)
  })

  it('addTeam 실패 → 500, 그 사유를 위장하지 않고 그대로 전달, RPC 미호출', async () => {
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: SUPER_ACTOR })
    mocks.addTeam.mockResolvedValue({ ok: false, error: '팀 생성 실패: db down' })
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(res.status).toBe(500)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — 팀 부트스트랩(0071, 프로젝트 스코프 — projectTeamRowsSync 비어있지 않음)', () => {
  const PROJECT_TEAM_ROWS = [{ code: 'PMO', projectId: PROJECT_ID }]

  it('팀 정의 프로젝트 + 미등록 팀 + registerTeams=false → 409 needsTeams scope:project, 슈퍼유저 가드 미호출', async () => {
    mocks.projectTeamRowsSync.mockReturnValue(PROJECT_TEAM_ROWS)
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ needsTeams: ['NEWTEAM'], scope: 'project' })
    expect(mocks.requireSuperuser).not.toHaveBeenCalled()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('팀 정의 프로젝트 + registerTeams=true(비슈퍼유저 관리자로 충분) → addProjectTeam 경유, 전역 addTeam·requireSuperuser 미호출', async () => {
    mocks.projectTeamRowsSync.mockReturnValue(PROJECT_TEAM_ROWS)
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    // requireSuperuser 기본 mock 은 ok:false 지만(beforeEach), 프로젝트 스코프 분기는 이를 아예 호출하지 않는다 —
    // 상단 requireProjectAdmin(라우트 진입 가드)만으로 충분하다는 것이 이 테스트의 핵심 단언.
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(mocks.addProjectTeam).toHaveBeenCalledWith(PROJECT_ID, 'NEWTEAM')
    expect(mocks.addTeam).not.toHaveBeenCalled()
    expect(mocks.requireSuperuser).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('addProjectTeam 실패 → 500, 사유를 위장하지 않고 그대로 전달, RPC 미호출', async () => {
    mocks.projectTeamRowsSync.mockReturnValue(PROJECT_TEAM_ROWS)
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    mocks.addProjectTeam.mockResolvedValue({ ok: false, error: '팀 생성 실패: db down' })
    const res = await POST(req(baseFields({ registerTeams: 'true' })))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('db down')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('teamsForProjectSync 가 이미(비활성 포함) 등록된 것으로 보고하면 대조 통과 — 등록 액션 자체가 호출되지 않는다', async () => {
    mocks.projectTeamRowsSync.mockReturnValue(PROJECT_TEAM_ROWS)
    mocks.teamsForProjectSync.mockReturnValue([...KNOWN_TEAMS, { code: 'NEWTEAM' }])
    mocks.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW_UNKNOWN_TEAM], holidays: [] })
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(200)
    expect(mocks.addProjectTeam).not.toHaveBeenCalled()
    expect(mocks.addTeam).not.toHaveBeenCalled()
  })
})

describe('POST /api/import/execute — append', () => {
  it('성공 — import_wbs RPC 호출, backup 없음, 팀 백업 select 없음', async () => {
    const sb = makeSbClient({ rpc: { data: 7, error: null } })
    mocks.createServerClient.mockResolvedValue(sb)
    const res = await POST(req(baseFields({ mode: 'append' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, count: 7, mode: 'append', reindexed: 3, profileSaved: false })
    expect(sb.rpc).toHaveBeenCalledWith('import_wbs', {
      p_project_id: PROJECT_ID, p_items: [LINKED_ITEM], p_holidays: [],
    })
    expect(sb.from).not.toHaveBeenCalled() // append 는 백업을 만들지 않는다
  })

  it('import_wbs RPC 오류 → 500', async () => {
    const sb = makeSbClient({ rpc: { data: null, error: { message: 'insert failed' } } })
    mocks.createServerClient.mockResolvedValue(sb)
    const res = await POST(req(baseFields({ mode: 'append' })))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'insert failed' })
  })
})

describe('POST /api/import/execute — replace', () => {
  it('백업 select 실패 → 500, RPC 미호출(중단)', async () => {
    const sb = makeSbClient({ backup: { data: null, error: { message: 'read failed' } } })
    mocks.createServerClient.mockResolvedValue(sb)
    const res = await POST(req(baseFields({ mode: 'replace' })))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('read failed')
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('성공 — 백업 선행 후 replace_wbs 호출, 응답에 backup+경고 포함', async () => {
    const backupRows = [{ id: 'w1', project_id: PROJECT_ID, name: '기존 항목' }]
    const sb = makeSbClient({ backup: { data: backupRows, error: null }, rpc: { data: 9, error: null } })
    mocks.createServerClient.mockResolvedValue(sb)
    const res = await POST(req(baseFields({ mode: 'replace' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.count).toBe(9)
    expect(body.mode).toBe('replace')
    expect(body.backup.rows).toEqual(backupRows)
    expect(typeof body.backup.generatedAt).toBe('string')
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('휴일은 삭제되지 않고 갱신만 됩니다'),
    ]))
    expect(sb.rpc).toHaveBeenCalledWith('replace_wbs', {
      p_project_id: PROJECT_ID, p_items: [LINKED_ITEM], p_holidays: [],
    })
  })

  it('replace_wbs RPC 오류 → 500(백업은 이미 select 됨)', async () => {
    const sb = makeSbClient({
      backup: { data: [], error: null },
      rpc: { data: null, error: { message: 'replace failed' } },
    })
    mocks.createServerClient.mockResolvedValue(sb)
    const res = await POST(req(baseFields({ mode: 'replace' })))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'replace failed' })
  })
})

describe('POST /api/import/execute — saveProfile(Q4)', () => {
  it('saveProfile=true → project_settings.excel_profile upsert 페이로드 확인, profileSaved:true', async () => {
    const admin = makeAdminClient()
    mocks.createAdminClient.mockReturnValue(admin)
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profileSaved).toBe(true)
    // 0058 project_settings 는 updated_at 트리거가 없다(0038 관례) — UPDATE 분기에서 default now() 가
    // 안 타므로 앱이 두 필드를 직접 채운다(actions/llmConfig.ts:285 선례). 가드가 돌려준 actor 의 id 를 쓴다.
    expect(admin.upsert).toHaveBeenCalledWith(
      {
        project_id: PROJECT_ID, excel_profile: LEGACY_DCUBE_PROFILE,
        updated_by: ACTOR.userId, updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      },
      { onConflict: 'project_id' },
    )
  })

  it('saveProfile=false → upsert 호출 없음, profileSaved:false', async () => {
    const admin = makeAdminClient()
    mocks.createAdminClient.mockReturnValue(admin)
    const res = await POST(req(baseFields({ saveProfile: 'false' })))
    const body = await res.json()
    expect(body.profileSaved).toBe(false)
    expect(admin.upsert).not.toHaveBeenCalled()
  })

  it('upsert 실패해도 임포트 자체는 성공(무시하고 로깅) — profileSaved:false', async () => {
    const admin = makeAdminClient({ upsertError: { message: 'db down' } })
    mocks.createAdminClient.mockReturnValue(admin)
    const res = await POST(req(baseFields({ saveProfile: 'true' })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.profileSaved).toBe(false)
  })
})

describe('POST /api/import/execute — 후처리(스냅샷·색인)', () => {
  it('recordProgressSnapshot 을 프로젝트 id 로 호출한다', async () => {
    await POST(req(baseFields()))
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('ingestProject 실패해도 응답은 200 유지, reindexed=0', async () => {
    mocks.ingestProject.mockRejectedValue(new Error('embed down'))
    const res = await POST(req(baseFields()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.reindexed).toBe(0)
  })
})
