import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  ingestMinute: vi.fn(async () => {}),
  generateMinuteInsights: vi.fn(async () => {}),
  enqueueAndProcessMinuteWiki: vi.fn(async () => {}),
  enqueueMinuteWikiProcessing: vi.fn(async (args: { projectId?: string | null }) =>
    args.projectId ? 71 : null),
  processMinuteWikiJob: vi.fn(async () => ({
    created: 0, changed: 0, reaffirmed: 0, conflicted: 0,
  })),
  rebuildProjectWikiFromActiveMinutes: vi.fn(async () => {}),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  // 팀 마스터는 런타임 캐시(TTL+DB) — 테스트는 활성 목록을 직접 갈아끼운다(W1-b 검증용).
  activeTeamCodes: ['PMO', 'ERP', 'MES', '가공', 'MDM'] as string[],
}))

vi.mock('@/lib/teams/master', () => ({ activeTeamCodesSync: () => mocks.activeTeamCodes }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// inline meeting 헬퍼(minutes/meetings.ts)가 revalidatePath 를 호출한다 — vitest(요청 스코프 밖)
// 에서는 throw 하므로 after() 와 같은 이유로 목킹한다.
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: mocks.ingestMinute }))
vi.mock('@/lib/ai/minutes-insights', () => ({ generateMinuteInsights: mocks.generateMinuteInsights }))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueAndProcessMinuteWiki: mocks.enqueueAndProcessMinuteWiki,
  enqueueMinuteWikiProcessing: mocks.enqueueMinuteWikiProcessing,
  processMinuteWikiJob: mocks.processMinuteWikiJob,
  rebuildProjectWikiFromActiveMinutes: mocks.rebuildProjectWikiFromActiveMinutes,
}))
// after()는 요청 스코프 밖(vitest)에서 throw — 콜백을 수집해 테스트가 명시적으로 실행·단언한다.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => Promise<void> | void) => { mocks.afterCallbacks.push(cb) } }
})

import { GET, POST } from '@/app/api/v1/minutes/route'
import { POST as LINK } from '@/app/api/v1/minutes/link/route'
import { GET as META } from '@/app/api/v1/minutes/meta/route'

const SECRET = 'test-minutes-secret'
const EXTERNAL_ID = 'ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77'
const MINUTE_UUID = '3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90'
const MEETING_UUID = '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f'
const PROJECT_UUID = '90b95d7d-8d5c-4f8c-9915-4a07b876af27'
const OLD_PROJECT_UUID = 'e91f75a0-8a6b-4ff9-9ceb-407fa8e73de0'
const USER = { id: 'u-1', email: 'jerry@example.com', user_metadata: { full_name: '팀장' } }

type QueryResponse = {
  data?: unknown
  error?: { message?: string; code?: string } | null
  count?: number | null
}

/** thenable query builder — 체인 메서드 전부 builder 반환, await 시 응답 resolve (index-worker 테스트 관례). */
function queryBuilder(response: QueryResponse | (() => QueryResponse)) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'is', 'not',
    'gte', 'lte', 'in', 'or', 'order', 'range', 'limit', 'maybeSingle', 'single',
  ]) builder[method] = vi.fn(() => builder)
  builder.then = (resolve, reject) => {
    const result = typeof response === 'function' ? response() : response
    return Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve, reject)
  }
  return builder
}

type FakeUser = { id: string; email: string; user_metadata?: Record<string, unknown>; deleted_at?: string }

/** 테이블별 응답 큐 — from(table) 호출 순서대로 소비. builders에 호출된 빌더를 남겨 인자 단언에 쓴다. */
function fakeAdmin(
  tables: Record<string, QueryResponse[]> = {},
  users: FakeUser[] = [USER],
  opts: { usersError?: boolean } = {},
) {
  const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      const queued = (tables[table] ?? []).shift()
      const b = queryBuilder(queued ?? { data: null, error: null })
      ;(builders[table] ??= []).push(b)
      return b
    }),
    // 회의록+v1 생성 및 본문+새 버전 교체는 0045 RPC 한 트랜잭션으로 수행된다.
    // 기존 fixture의 두 번째 minutes 응답을 RPC 결과로 변환해 테스트 의도는 그대로 유지한다.
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      const queued = (tables.minutes ?? []).shift() ?? { data: null, error: null }
      if (queued.error) return queryBuilder(queued)
      const row = queued.data as Record<string, unknown> | null
      if (fn === 'create_minute_with_version') {
        return queryBuilder({
          data: row
            ? {
                minute_id: row.id,
                version_id: 'mv-1',
                created_at: row.created_at,
                updated_at: row.updated_at,
                wiki_rebuild_required:
                  row.wiki_rebuild_required === true || args.p_project_id != null,
              }
            : null,
        })
      }
      if (fn === 'commit_minute_body_version') {
        return queryBuilder({
          data: row
            ? {
                version_id: 'mv-2',
                wiki_rebuild_required: row.wiki_rebuild_required === true,
              }
            : null,
        })
      }
      return queryBuilder({ data: null, error: { message: `unexpected rpc: ${fn}` } })
    }),
    auth: {
      admin: {
        listUsers: vi.fn(async () =>
          opts.usersError
            ? { data: null, error: { message: 'auth unavailable' } }
            : { data: { users }, error: null },
        ),
      },
    },
  }
  return { admin, builders }
}

function useAdmin(
  tables: Record<string, QueryResponse[]> = {},
  users: FakeUser[] = [USER],
  opts: { usersError?: boolean } = {},
) {
  const fake = fakeAdmin(tables, users, opts)
  mocks.createAdminClient.mockReturnValue(fake.admin)
  return fake
}

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/minutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${SECRET}`, ...headers },
  })
}

function link(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/minutes/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}`, ...headers },
    body: JSON.stringify(body),
  })
}

const payload = {
  user_email: 'jerry@example.com',
  date: '2026-07-16',
  team: 'PMO',
  title: '물류-물류공정_260716',
  body_markdown: '# 회의록\n\n안건 정리',
  external_id: EXTERNAL_ID,
}

const existingRow = {
  id: 'm-1',
  minute_date: '2026-07-01',
  team_code: 'PMO',
  title: '옛제목',
  body_md: '# 옛 회의록\n\n기존 본문',
  meeting_id: null,
  project_id: null,
  meeting_occurrence_date: null,
  archived_at: null,
  external_id: EXTERNAL_ID,
  created_by: 'u-original',
  created_by_name: '원작성자',
  created_at: '2026-07-01T00:00:00+00:00',
  updated_at: '2026-07-01T00:00:00+00:00',
}

async function runAfterCallbacks() {
  for (const cb of mocks.afterCallbacks) await cb()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.afterCallbacks.length = 0
  mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공', 'MDM']
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  vi.stubEnv('MINUTES_API_SECRET', SECRET)
  // W25 — folder_path 편철 스위치. 이 스위트는 켠 상태를 기본으로 검증하고,
  // 끈 상태(R1 배포 형상)는 전용 describe 에서 따로 본다.
  vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'true')
  // 후처리 rematch 래퍼의 env 가드가 확실히 잠기도록(하이라이트 경로는 이 스위트 범위 밖)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
  useAdmin()
})

describe('인증 게이트 (§3, §9.6 ①②)', () => {
  it('MINUTES_API_ENABLED 미설정이면 전 라우트 404 — 존재 은닉, DB 미접근', async () => {
    vi.stubEnv('MINUTES_API_ENABLED', 'false')
    expect((await POST(post(payload))).status).toBe(404)
    expect((await GET(get('/api/v1/minutes'))).status).toBe(404)
    expect((await META(get('/api/v1/minutes/meta'))).status).toBe(404)
    expect((await LINK(link({ user_email: 'a@b.c', minute_id: 'm-1', external_id: EXTERNAL_ID }))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('시크릿이 비어 있으면 플래그가 켜져 있어도 404', async () => {
    vi.stubEnv('MINUTES_API_SECRET', '')
    expect((await POST(post(payload))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('시크릿 불일치/누락은 401 unauthorized', async () => {
    const wrong = await POST(post(payload, { Authorization: 'Bearer wrong' }))
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ code: 'unauthorized' })
    const missing = await GET(get('/api/v1/minutes', { Authorization: '' }))
    expect(missing.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/minutes 검증 (§3.4, §6, §9.6 ③④)', () => {
  it('미지 이메일은 403 unknown_user — 레코드 미생성', async () => {
    const { builders } = useAdmin({}, [])
    const res = await POST(post(payload))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'unknown_user' })
    expect(builders.minutes).toBeUndefined()
  })

  it('삭제된 계정(deleted_at)은 매칭에서 제외되어 403', async () => {
    useAdmin({}, [{ ...USER, deleted_at: '2026-01-01T00:00:00Z' }])
    const res = await POST(post(payload))
    expect(res.status).toBe(403)
  })

  it('이메일은 lower/trim 정규화 후 매칭된다', async () => {
    const { admin, builders } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-9', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, user_email: '  Jerry@Example.COM ' }))
    expect(res.status).toBe(201)
    expect(builders.minutes).toHaveLength(1)
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.any(Object))
  })

  it('user_email 누락은 400', async () => {
    const res = await POST(post({ ...payload, user_email: undefined }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
  })

  it('잘못된 JSON 바디는 400', async () => {
    expect((await POST(post('not-json{{'))).status).toBe(400)
  })

  it('필수 필드 누락(body_markdown)은 400', async () => {
    const res = await POST(post({ ...payload, body_markdown: undefined }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
  })

  it('허용 외 team은 400', async () => {
    expect((await POST(post({ ...payload, team: 'QA' }))).status).toBe(400)
  })

  it('본문 100,000자 초과는 400', async () => {
    const res = await POST(post({ ...payload, body_markdown: 'a'.repeat(100_001) }))
    expect(res.status).toBe(400)
  })

  it('external_id 빈 값/128자 초과는 400', async () => {
    expect((await POST(post({ ...payload, external_id: '' }))).status).toBe(400)
    expect((await POST(post({ ...payload, external_id: 'x'.repeat(129) }))).status).toBe(400)
  })

  it('on_conflict 허용 외 값은 400', async () => {
    expect((await POST(post({ ...payload, on_conflict: 'merge' }))).status).toBe(400)
  })

  it('meeting_id가 존재하지 않으면 400', async () => {
    useAdmin({ meetings: [{ data: null }] })
    const res = await POST(post({ ...payload, meeting_id: '00000000-0000-0000-0000-000000000000' }))
    expect(res.status).toBe(400)
  })

  it('meeting_id가 uuid 형식이 아니면 DB 조회 전에 400 (§6 형식 오류)', async () => {
    const { builders } = useAdmin()
    const res = await POST(post({ ...payload, meeting_id: 'abc' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    expect(builders.meetings).toBeUndefined()
  })

  it('listUsers 실패는 403이 아니라 500 — 장애를 사용자 없음으로 오귀속 금지', async () => {
    useAdmin({}, [USER], { usersError: true })
    const res = await POST(post(payload))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'internal_error' })
  })
})

describe('POST /api/v1/minutes upsert (§4, §9.6 ⑤⑥⑦⑧⑨)', () => {
  it('신규는 201 created — external_id·작성자 귀속 저장 + 후처리(ingest→insights)', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-19T01:00:00+00:00', updated_at: '2026-07-19T01:00:00+00:00' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true, id: 'm-1', action: 'created',
      title: payload.title, date: payload.date, team: 'PMO',
      external_id: EXTERNAL_ID, created_by_name: '팀장',
      url: 'http://localhost/minutes/m-1',
    })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_minute_date: payload.date,
      p_team_code: 'PMO',
      p_title: payload.title,
      p_body_md: payload.body_markdown,
      p_external_id: EXTERNAL_ID,
      p_actor_id: 'u-1',
      p_actor_name: '팀장',
    }))
    expect(mocks.afterCallbacks).toHaveLength(1)
    await runAfterCallbacks()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.generateMinuteInsights).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.enqueueMinuteWikiProcessing).toHaveBeenCalledWith(expect.objectContaining({
      minuteId: 'm-1',
      minuteVersionId: 'mv-1',
      projectId: null,
      bodyMd: payload.body_markdown,
    }))
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('신규 insert는 담당 팀 루트 폴더로 자동 편철 — folder_id 세팅(0043)', async () => {
    const { admin, builders } = useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-24T01:00:00+00:00', updated_at: '2026-07-24T01:00:00+00:00' } },
      ],
      minute_folders: [{ data: { id: 'f-pmo' } }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    const fq = builders.minute_folders[0]
    expect(fq.is).toHaveBeenCalledWith('parent_id', null)     // 루트 한정
    expect(fq.is).toHaveBeenCalledWith('created_by', null)    // 시드 고정(스쿼팅 배제)
    expect(fq.eq).toHaveBeenCalledWith('name', 'PMO')         // 팀코드 동명 매칭
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version',
      expect.objectContaining({ p_folder_id: 'f-pmo' }),
    )
  })

  it('팀 루트 폴더 조회 실패는 미분류(null) 폴백 — 등록은 막지 않는다(201)', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-24T01:00:00+00:00', updated_at: '2026-07-24T01:00:00+00:00' } },
      ],
      minute_folders: [{ data: null, error: { message: 'lookup down' } }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version',
      expect.objectContaining({ p_folder_id: null }),
    )
  })

  it('W1-b: 6번째 팀을 등록하면 meta 가 노출하는 그 팀으로 POST 가 통과한다', async () => {
    // 수정 전에는 validateMinuteInput 이 @deprecated 하드코딩 5팀을 써서 전건 400 이었다.
    mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공', 'MDM', '신설팀']
    useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' } },
      ],
      minute_folders: [{ data: { id: 'f-new' } }],
    })
    const res = await POST(post({ ...payload, team: '신설팀' }))
    expect(res.status).toBe(201)
  })

  it('W1-b: 활성 목록에 없는 팀은 그대로 400', async () => {
    const res = await POST(post({ ...payload, team: '없는팀' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('잘못된 담당입니다.')
  })

  it('같은 external_id 재전송(기본 replace)은 200 replaced — D3 범위만 갱신, 소유권 불변', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: existingRow },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-19T02:00:00+00:00' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, id: 'm-1', action: 'replaced', created_by_name: '원작성자',
    })
    const commitCall = admin.rpc.mock.calls.find(
      ([fn]) => fn === 'commit_minute_body_version',
    )
    expect(commitCall).toBeDefined()
    const committed = commitCall![1]
    expect(committed).toMatchObject({
      p_minute_id: 'm-1',
      p_body_md: payload.body_markdown,
      p_actor_id: 'u-1',
      p_metadata: expect.objectContaining({
        minute_date: payload.date,
        team_code: 'PMO',
        title: payload.title,
        project_id: null,
      }),
    })
    const metadata = committed.p_metadata as Record<string, unknown>
    // §0 D3 — 소유권·멱등키는 갱신 범위 밖, meeting_id는 미전송이므로 유지(v2.2)
    expect(Object.keys(metadata)).not.toContain('created_by')
    expect(Object.keys(metadata)).not.toContain('created_by_name')
    expect(Object.keys(metadata)).not.toContain('external_id')
    expect(metadata.meeting_id).toBe(existingRow.meeting_id)
    await runAfterCallbacks()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.generateMinuteInsights).toHaveBeenCalledWith('m-1', payload.body_markdown)
  })

  it('on_conflict=skip은 200 skipped — 변경 없이 기존 레코드 반환', async () => {
    const { builders } = useAdmin({ minutes: [{ data: existingRow }] })
    const res = await POST(post({ ...payload, on_conflict: 'skip' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'skipped', title: '옛제목', date: '2026-07-01' })
    expect(builders.minutes).toHaveLength(1)
    expect(mocks.afterCallbacks).toHaveLength(0)
  })

  it('on_conflict=error는 409 conflict', async () => {
    useAdmin({ minutes: [{ data: existingRow }] })
    const res = await POST(post({ ...payload, on_conflict: 'error' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'conflict' })
  })

  it('기존 레코드가 없으면 on_conflict 값과 무관하게 항상 201 created (§4.2 보장)', async () => {
    useAdmin({ minutes: [{ data: null }, { data: { id: 'm-2', created_at: 't', updated_at: 't' } }] })
    expect((await POST(post({ ...payload, on_conflict: 'error' }))).status).toBe(201)
  })

  it('4마커 헤더가 있어도 시간(+9h) 보정을 하지 않는다 (§1.4 회귀 방지 — 필수)', async () => {
    const ddobakBody = [
      '# 물류공정_260716', '',
      '- **날짜**: 2026-07-16',
      '- **시간**: 14:00 ~ 15:10',
      '- **상태**: 완료',
      '- **생성자**: jjinie73@gmail.com', '',
      '## AI 회의록',
    ].join('\n')
    const { admin } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-3', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, body_markdown: ddobakBody }))
    expect(res.status).toBe(201)
    const args = admin.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args.p_body_md).toBe(ddobakBody)
    expect(args.p_body_md).toContain('14:00 ~ 15:10')
  })

  it('replace 경로도 4마커 본문을 무보정으로 저장한다 (§9.6 ⑨ — 또박또박 일상 흐름은 재전송)', async () => {
    const ddobakBody = [
      '# 물류공정_260716', '',
      '- **날짜**: 2026-07-16',
      '- **시간**: 14:00 ~ 15:10',
      '- **상태**: 완료',
      '- **생성자**: jjinie73@gmail.com',
    ].join('\n')
    const { admin } = useAdmin({
      minutes: [{ data: existingRow }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, body_markdown: ddobakBody }))
    expect(res.status).toBe(200)
    const args = admin.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args.p_body_md).toBe(ddobakBody)
    expect(args.p_body_md).toContain('14:00 ~ 15:10')
  })

  it('meeting_id가 존재하면 프로젝트 ordered rebuild로 저장·응답된다', async () => {
    const { admin, builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: null }, { data: { id: 'm-5', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    expect((await res.json()).meeting_id).toBe(MEETING_UUID)
    expect(builders.meetings[0].select).toHaveBeenCalledWith('id, project_id')
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_meeting_id: MEETING_UUID,
      p_project_id: PROJECT_UUID,
    }))
    await runAfterCallbacks()
    expect(mocks.enqueueMinuteWikiProcessing).toHaveBeenCalledWith(expect.objectContaining({
      minuteId: 'm-5',
      projectId: PROJECT_UUID,
      minuteVersionId: 'mv-1',
    }))
    expect(mocks.rebuildProjectWikiFromActiveMinutes).toHaveBeenCalledWith(PROJECT_UUID)
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('과거 시점 신규 회의록도 단일 job 선처리 대신 durable 프로젝트 rebuild를 진행한다', async () => {
    useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [
        { data: null },
        {
          data: {
            id: 'm-backdated',
            created_at: '2026-07-26T01:00:00+00:00',
            updated_at: '2026-07-26T01:00:00+00:00',
            wiki_rebuild_required: true,
          },
        },
      ],
    })

    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    await runAfterCallbacks()

    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenCalledWith(PROJECT_UUID)
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-backdated', payload.body_markdown)
  })

  it('replace: meeting_id 미전송은 기존 연결 유지, 명시적 null은 해제 (§0 D3 v2.2)', async () => {
    const withMeeting = { ...existingRow, meeting_id: MEETING_UUID }
    // 미전송 → 갱신 범위에서 제외 + 기존 값 echo
    let fake = useAdmin({
      minutes: [{ data: withMeeting }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    let res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect((await res.json()).meeting_id).toBe(MEETING_UUID)
    let metadata = fake.admin.rpc.mock.calls[0][1].p_metadata as Record<string, unknown>
    expect(metadata.meeting_id).toBe(MEETING_UUID)
    // 명시적 null → 해제
    fake = useAdmin({
      minutes: [{ data: withMeeting }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    res = await POST(post({ ...payload, meeting_id: null }))
    expect(res.status).toBe(200)
    expect((await res.json()).meeting_id).toBeNull()
    metadata = fake.admin.rpc.mock.calls[0][1].p_metadata as Record<string, unknown>
    expect(metadata.meeting_id).toBeNull()
  })

  it('replace로 프로젝트가 바뀌면 old/new Wiki를 모두 재구성하고 단일 job을 직접 처리하지 않는다', async () => {
    useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [
        { data: { ...existingRow, project_id: OLD_PROJECT_UUID } },
        { data: { id: 'm-1', created_at: 't', updated_at: 't' } },
      ],
    })

    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(200)
    await runAfterCallbacks()

    expect(mocks.rebuildProjectWikiFromActiveMinutes).toHaveBeenCalledTimes(2)
    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenNthCalledWith(1, OLD_PROJECT_UUID, 'm-1')
    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenNthCalledWith(2, PROJECT_UUID)
    expect(mocks.enqueueMinuteWikiProcessing).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_UUID,
      minuteId: 'm-1',
      minuteVersionId: 'mv-2',
    }))
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('replace에서 본문이 바뀌면 같은 프로젝트의 최신 회의록 버전을 시간순 재구성한다', async () => {
    useAdmin({
      minutes: [
        { data: { ...existingRow, project_id: PROJECT_UUID } },
        {
          data: {
            id: 'm-1',
            created_at: 't',
            updated_at: 't',
            wiki_rebuild_required: true,
          },
        },
      ],
    })

    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    await runAfterCallbacks()

    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenCalledWith(PROJECT_UUID)
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('동시 전송 경합(insert 23505)은 기존 레코드 기준 replace로 수렴한다', async () => {
    useAdmin({
      minutes: [
        { data: null },
        { error: { code: '23505', message: 'duplicate key' } },
        { data: existingRow },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: 'u' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'replaced' })
  })

  it('replace 후처리: rematch(하이라이트) 복제본이 ingest보다 먼저 실행된다 (§4.5-7)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    const { builders } = useAdmin({
      minutes: [{ data: existingRow }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
      minute_highlights: [
        {
          data: [{
            id: 'h-1', created_by: 'u-1', created_by_name: null,
            block_index: 0, block_hash: 'stale-hash', created_at: 't',
          }],
        },
        { data: null }, // 재배정 불가 행 delete
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    await runAfterCallbacks()
    expect(builders.minute_highlights).toHaveLength(2)
    expect(builders.minute_highlights[1].delete).toHaveBeenCalled()
    const deleteOrder = builders.minute_highlights[1].delete.mock.invocationCallOrder[0]
    const ingestOrder = mocks.ingestMinute.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(ingestOrder)
  })
})

describe('folder_path 편철 (v2.3 §3.1~§3.3 — W3·W4·W5)', () => {
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }
  const insertQueue = [{ data: null }, { data: created }]
  // resolveFolderPath 는 폴더 전량 스냅샷 1회 + 부족분 insert 순으로 질의한다.
  const SEED_PMO = { id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null }
  const snapshot = (...rs: Array<Record<string, unknown>>) => ({ data: [SEED_PMO, ...rs] })

  /** 신규 등록 경로의 minute_folders 응답 큐를 세팅한다. */
  function useInsert(folderQueue: Array<{ data?: unknown; error?: { message?: string; code?: string } }>) {
    return useAdmin({ minutes: [...insertQueue], minute_folders: folderQueue })
  }

  it('경로대로 편철하고 응답에 folder_id·folder_path 를 에코한다', async () => {
    const { admin } = useInsert([
      snapshot({ id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9' }),
      { data: { id: 'f-w' } },                                            // 주간정례 생성
    ])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질', '주간정례'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_id: 'f-w', folder_path: ['PMO', '품질', '주간정례'],
    })
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-w' }),
    )
  })

  it('자유 루트는 팀 루트 아래로 한 칸 내려 편철하고 그 경로를 에코한다(§3.2 ②)', async () => {
    useInsert([snapshot(), { data: { id: 'f-tf' } }, { data: { id: 'f-kick' } }])
    const res = await POST(post({ ...payload, folder_path: ['신규TF', '킥오프'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_id: 'f-kick', folder_path: ['PMO', '신규TF', '킥오프'],
    })
  })

  it('folder_path: [] 는 팀 루트 편철 — folder_path 에코는 [팀코드]', async () => {
    const { admin } = useInsert([snapshot()])
    const res = await POST(post({ ...payload, folder_path: [] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-pmo' }),
    )
  })

  it('키 부재는 회귀 없음 — 기존 팀 루트 편철 + 에코 [팀코드]', async () => {
    useInsert([{ data: { id: 'f-pmo' } }])
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
  })

  it('시드 루트 부재 → folder_id·folder_path 둘 다 null (E1: [] 아님), 등록은 201', async () => {
    const { admin } = useInsert([{ data: [] }])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.folder_id).toBeNull()
    expect(json.folder_path).toBeNull()          // [] 로 두면 "팀 루트 편철됨"이라는 정반대 안내가 된다
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: null }),
    )
  })

  it('6단 경로는 5단으로 절단해 편철하고 절단된 경로를 에코한다', async () => {
    useInsert([
      snapshot(),
      { data: { id: 'f-a' } }, { data: { id: 'f-b' } },
      { data: { id: 'f-c' } }, { data: { id: 'f-d' } },
    ])
    const res = await POST(post({ ...payload, folder_path: ['신규TF', 'A', 'B', 'C', 'D'] }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.folder_path).toEqual(['PMO', '신규TF', 'A', 'B', 'C'])   // 5단
    expect(json.folder_id).toBe('f-d')
  })

  it('타 팀의 팀코드가 최상위면 400 validation_failed (§3.2 ③)', async () => {
    const res = await POST(post({ ...payload, folder_path: ['ERP', '영업'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('validation_failed')
  })

  it('61자 폴더명은 400 — 절단하지 않는다(D3)', async () => {
    const res = await POST(post({ ...payload, folder_path: ['PMO', '가'.repeat(61)] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('61자')
  })

  it('배열이 아니면 400', async () => {
    expect((await POST(post({ ...payload, folder_path: 'PMO/품질' }))).status).toBe(400)
    expect((await POST(post({ ...payload, folder_path: null }))).status).toBe(400)
  })

  it('동시 전송 경합(23505) 흡수 — 500 없이 재조회한 폴더로 편철', async () => {
    useInsert([
      snapshot(),
      { data: null, error: { code: '23505', message: 'dup' } },
      { data: { id: 'f-raced' } },
    ])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-raced' })
  })

  it('자동 생성 폴더의 created_by 는 전송 사용자 — null(시드 표식) 금지(C4)', async () => {
    const { builders } = useInsert([snapshot(), { data: { id: 'f-q' } }])
    await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: '품질', parent_id: 'f-pmo', created_by: 'u-1',
    })
  })

  describe('replace 3값 규약 (D1=B · W5)', () => {
    /** replace 경로의 metadata 인자를 꺼낸다. */
    function metadataOf(admin: { rpc: { mock: { calls: unknown[][] } } }) {
      const call = admin.rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')
      return (call![1] as { p_metadata: Record<string, unknown> }).p_metadata
    }

    const replaceQueue = [
      { data: { ...existingRow, folder_id: 'f-old' } },
      { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-27T02:00:00+00:00' } },
    ]

    it('키 부재 → metadata 에 folder_id 키가 없다(기존 위치 유지)', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [{ data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null }] }],  // 에코 역해석
      })
      const res = await POST(post(payload))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ folder_id: 'f-old', folder_path: ['PMO'] })
    })

    it('[] → 팀 루트로 되돌림(metadata 에 팀 루트 id)', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [snapshot()],
      })
      const res = await POST(post({ ...payload, folder_path: [] }))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-pmo' })
      expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
    })

    it('경로 → 그 경로로 이동', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [snapshot({ id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9' })],
      })
      const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-q' })
      expect(await res.json()).toMatchObject({ folder_id: 'f-q', folder_path: ['PMO', '품질'] })
    })

    it('부분 편철(중간 폴더 생성 실패)은 기존 위치를 유지한다 — 조상으로 강등하지 않는다', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [
          snapshot(),                                                   // 팀 루트만 존재
          { data: null, error: { code: '42501', message: 'denied' } },  // '품질' 생성 실패
          { data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null }] },  // 에코 역해석
        ],
      })
      const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(200)
      // 배치는 같은 상황을 failed(folder_error) 로 막는다 — replace 도 자리를 옮기지 않는다
      expect(metadataOf(admin)).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ folder_id: 'f-old' })
    })

    it('시드 루트 부재 → metadata 에 folder_id 키 없음 (미분류로 강등하지 않는다)', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [
          { data: [] },                                                                 // 시드 루트 없음
          { data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null }] },   // 에코 역해석
        ],
      })
      const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ folder_id: 'f-old' })
    })

    it('folder_id 는 v_index_content_changed 대상이 아니다 — 폴더만 바뀌면 위키 잡 없음', async () => {
      useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [snapshot({ id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9' })],
      })
      await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(mocks.enqueueMinuteWikiProcessing).not.toHaveBeenCalled()
    })
  })
})

describe('W25 MINUTES_FOLDER_PATH_ENABLED = false (R1 배포 형상 · 결정 §2-A)', () => {
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }

  it('folder_path 를 키 부재와 동일하게 무시하고 팀 루트로 편철한다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: { id: 'f-pmo' } }],       // resolveTeamRootFolderId 경로
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질', '주간정례'] }))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-pmo' }),
    )
    // 에코는 요청 경로가 아니라 **실제 편철 위치**(팀 루트)여야 한다
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
  })

  it('검증 400 조차 내지 않는다 — 61자 폴더명·타 팀 루트가 섞여도 오늘처럼 전송된다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    // 플래그 없이 W1 만 먼저 내면 이 세 입력이 400 이 되어 오늘 정상 전송되는 회의가 실패한다.
    const queue = () => ({
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: { id: 'f-pmo' } }],
    })
    useAdmin(queue())
    expect((await POST(post({ ...payload, folder_path: ['PMO', '가'.repeat(61)] }))).status).toBe(201)
    useAdmin(queue())
    expect((await POST(post({ ...payload, folder_path: ['ERP', '영업'] }))).status).toBe(201)
    useAdmin(queue())
    expect((await POST(post({ ...payload, folder_path: 'not-an-array' }))).status).toBe(201)
  })

  it('replace 의 폴더 갱신(W5)이 일어나지 않는다 — metadata 에 folder_id 키 없음', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [
        { data: { ...existingRow, folder_id: 'f-old' } },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-27T02:00:00+00:00' } },
      ],
      minute_folders: [{ data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null }] }],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(200)
    const call = admin.rpc.mock.calls.find(c => c[0] === 'commit_minute_body_version')!
    expect((call[1] as { p_metadata: Record<string, unknown> }).p_metadata).not.toHaveProperty('folder_id')
  })
})

describe('folder_path_status 에코 (결정 §2-C — POST 응답)', () => {
  // 배치 results[] 쪽은 folder-batch.test.ts 가 덮지만 등록 응답은 검증이 0이었다.
  // 또박또박 ddobak-W8 배지가 이 값 하나에 걸려 있어(절단·부분편철·미분류가 보이는 유일한 경로)
  // 조용히 잘못된 값이 나가면 사용자에게 "정상 편철"로 보인다.
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }
  const SEED_PMO = { id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null }
  const insertQueue = () => [{ data: null }, { data: created }]

  it('정상 편철 → exact', async () => {
    useAdmin({
      minutes: insertQueue(),
      minute_folders: [
        { data: [SEED_PMO, { id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9' }] },
      ],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-q', folder_path_status: 'exact' })
  })

  it('깊이 5 초과 절단 → truncated (경로도 5단으로 잘려 에코)', async () => {
    useAdmin({
      minutes: insertQueue(),
      minute_folders: [
        { data: [SEED_PMO] },
        { data: { id: 'f-a' } }, { data: { id: 'f-b' } }, { data: { id: 'f-c' } }, { data: { id: 'f-d' } },
      ],
    })
    const res = await POST(post({ ...payload, folder_path: ['신규TF', 'A', 'B', 'C', 'D'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_path: ['PMO', '신규TF', 'A', 'B', 'C'],
      folder_path_status: 'truncated',
    })
  })

  it('시드 루트 부재 → unclassified (등록은 201, folder_id·folder_path 는 null)', async () => {
    useAdmin({ minutes: insertQueue(), minute_folders: [{ data: [] }] })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toMatchObject({ folder_path_status: 'unclassified' })
    expect(json.folder_id).toBeNull()
    expect(json.folder_path).toBeNull()
  })

  it('중간 폴더 생성 실패 → partial (조상에 편철하고 200/201 을 그대로 낸다 — 종전엔 완전 침묵)', async () => {
    useAdmin({
      minutes: insertQueue(),
      minute_folders: [
        { data: [SEED_PMO] },
        { error: { message: 'insert denied' } },   // '품질' 생성 실패 → 조상(f-pmo)에 떨어진다
      ],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질', '주간정례'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_id: 'f-pmo', folder_path: ['PMO'], folder_path_status: 'partial',
    })
  })
})

describe('구버전 replace 의 team 불일치 (결정 §6 — 플래그와 무관하게 동작)', () => {
  // ⚠️ 이 경로는 §2-A 「플래그 표」와 계약 §4.8 의 "R1 은 POST /minutes 동작을 1비트도 바꾸지
  // 않는다"에 대한 **명시적 예외**다. folder_path 키가 없는 구버전 클라이언트가 담당만 정정해
  // 재전송하면 R1 구간에서도 폴더가 새 팀 루트로 옮겨진다. 계약 §4.5-11 이 정본.
  const replaced = { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-27T02:00:00+00:00' }
  const metadataOf = (admin: { rpc: { mock: { calls: unknown[][] } } }) => {
    const call = admin.rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')
    return (call![1] as { p_metadata: Record<string, unknown> }).p_metadata
  }

  it('플래그 false + folder_path 키 부재 + team 변경 → 새 팀 루트로 폴더를 옮긴다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      // resolveTeamRootFolderId(ERP) → f-erp, 그다음 응답은 에코 역해석용 스냅샷
      minute_folders: [
        { data: { id: 'f-erp' } },
        { data: [{ id: 'f-erp', name: 'ERP', parent_id: null, created_by: null }] },
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP' }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-erp', team_code: 'ERP' })
    expect(await res.json()).toMatchObject({ folder_id: 'f-erp', folder_path: ['ERP'] })
  })

  it('team 이 그대로면 폴더를 건드리지 않는다 (metadata 에 folder_id 키 없음)', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      minute_folders: [{ data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null }] }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).not.toHaveProperty('folder_id')
  })

  it('새 팀 루트가 없으면 폴더를 유지한다 — 등록 자체는 실패시키지 않는다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      minute_folders: [
        { data: null },                                                              // 팀 루트 조회 실패
        { data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null }] }, // 에코는 기존 위치
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP' }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).not.toHaveProperty('folder_id')
    expect(await res.json()).toMatchObject({ folder_id: 'f-old' })
  })

  it('플래그 true + folder_path 가 실려 오면 team 이동 분기를 타지 않는다 (folder_path 가 이긴다)', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'true')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      minute_folders: [
        { data: [
          { id: 'f-erp', name: 'ERP', parent_id: null, created_by: null },
          { id: 'f-sales', name: '영업', parent_id: 'f-erp', created_by: 'u-9' },
        ] },
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP', folder_path: ['ERP', '영업'] }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-sales' })
    expect(await res.json()).toMatchObject({ folder_id: 'f-sales', folder_path: ['ERP', '영업'] })
  })
})

describe('inline meeting — 회의 생성+연결 (v2.5 §4.2·§4.3)', () => {
  const meetingReq = {
    ...payload,
    meeting: { project_id: PROJECT_UUID, title: '킥오프 회의', date: '2026-08-06', category: 'kickoff' },
  }
  const createdMinute = {
    id: 'm-1', created_at: '2026-08-06T01:00:00+00:00', updated_at: '2026-08-06T01:00:00+00:00',
  }

  /** 회의 확보 성공 경로 큐 — projects 실존 → 멤버십 1행 → meetings dedup miss → insert. */
  function useMeetingAdmin(over: Record<string, QueryResponse[]> = {}) {
    return useAdmin({
      minutes: [{ data: null }, { data: createdMinute }],
      projects: [{ data: { id: PROJECT_UUID } }],
      project_members: [{ data: [{ id: 'pm-1' }] }],
      meetings: [{ data: null }, { data: { id: MEETING_UUID } }],
      ...over,
    })
  }

  it('meeting 유효 → 201 + 회의 생성(meeting_created: true) + 연결·파생은 meeting_id 전송과 동일', async () => {
    const { admin, builders } = useMeetingAdmin()
    const res = await POST(post(meetingReq))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      action: 'created', meeting_id: MEETING_UUID, meeting_created: true,
    })
    // 고정 속성 — 단발(recurrence none)·참석자 없음·작성자 귀속(§4.2)
    expect(builders.meetings[1].insert).toHaveBeenCalledWith({
      project_id: PROJECT_UUID, title: '킥오프 회의', meeting_date: '2026-08-06', category: 'kickoff',
      body: '', recurrence: 'none', recurrence_until: null,
      start_time: null, end_time: null, location: null,
      created_by: 'u-1', created_by_name: '팀장',
    })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_meeting_id: MEETING_UUID,
      p_project_id: PROJECT_UUID,
      p_meeting_occurrence_date: payload.date,
    }))
    // 내부 회의 화면 캐시 갱신 — revalidateMeetings 와 동일 경로
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/p/${PROJECT_UUID}/meetings`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/meetings')
  })

  it('같은 (project, date, title) 회의는 재사용 — meeting_created: false, insert 없음 (dedup 멱등)', async () => {
    const { builders } = useMeetingAdmin({ meetings: [{ data: { id: MEETING_UUID } }] })
    const res = await POST(post({ ...meetingReq, external_id: 'ddobak:재전송-2' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ meeting_id: MEETING_UUID, meeting_created: false })
    expect(builders.meetings).toHaveLength(1)          // dedup 조회뿐 — insert 없음
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('meeting + meeting_id 동시 전송은 400 — meeting_id: null(해제)과의 조합도 거절', async () => {
    const { builders } = useAdmin()                    // 파싱 단계 거절 — 테이블 큐 소비 없음
    for (const meetingId of [MEETING_UUID, null]) {
      const res = await POST(post({ ...meetingReq, meeting_id: meetingId }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    }
    expect(builders.projects).toBeUndefined()          // DB 미접근
  })

  it('category 생략은 general 로 생성, 허용 외 값은 400', async () => {
    const { builders } = useMeetingAdmin()
    const noCategory = { project_id: PROJECT_UUID, title: '킥오프 회의', date: '2026-08-06' }
    expect((await POST(post({ ...meetingReq, meeting: noCategory }))).status).toBe(201)
    expect(builders.meetings[1].insert).toHaveBeenCalledWith(expect.objectContaining({ category: 'general' }))
    expect((await POST(post({
      ...meetingReq, meeting: { ...meetingReq.meeting, category: 'offsite' },
    }))).status).toBe(400)
  })

  it('meeting 필드 형식 오류는 400 — 비객체·비uuid project_id·빈/201자 title·잘못된 date', async () => {
    const cases: unknown[] = [
      'not-an-object',
      { ...meetingReq.meeting, project_id: 'abc' },
      { ...meetingReq.meeting, title: '  ' },
      { ...meetingReq.meeting, title: '가'.repeat(201) },
      { ...meetingReq.meeting, date: '2026/08/06' },
    ]
    useAdmin()                                         // 전부 파싱 단계 거절 — 테이블 큐 소비 없음
    for (const meeting of cases) {
      const res = await POST(post({ ...meetingReq, meeting }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    }
  })

  it('프로젝트 미존재는 400, 비멤버는 403 not_project_member — dedup 조회 이전 차단', async () => {
    useMeetingAdmin({ projects: [{ data: null }] })
    const notFound = await POST(post(meetingReq))
    expect(notFound.status).toBe(400)
    expect((await notFound.json()).error).toBe('프로젝트를 찾을 수 없습니다.')

    const { builders } = useMeetingAdmin({ project_members: [{ data: [] }] })
    const denied = await POST(post(meetingReq))
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'not_project_member' })
    expect(builders.meetings).toBeUndefined()          // 비멤버는 dedup 재사용 우회도 못 탄다
  })

  it('기존 external_id + on_conflict=skip 은 회의를 만들지 않는다 — skipped 응답에 meeting_created 없음', async () => {
    const { builders } = useAdmin({ minutes: [{ data: existingRow }] })
    const res = await POST(post({ ...meetingReq, on_conflict: 'skip' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ action: 'skipped' })
    expect(json).not.toHaveProperty('meeting_created')
    expect(builders.projects).toBeUndefined()          // 회의 확보 시도 자체가 없다
    expect(builders.meetings).toBeUndefined()
  })

  it('보관된 레코드(409 archived)도 회의를 만들지 않는다 — 실패 응답 뒤 고아 회의 방지', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: { ...existingRow, archived_at: '2026-08-01T00:00:00+00:00' } }],
    })
    const res = await POST(post(meetingReq))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'archived' })
    expect(builders.projects).toBeUndefined()
  })

  it('replace + meeting 은 회의 확보 후 연결 갱신 — metadata 에 meeting_id·project_id·occurrence 파생', async () => {
    const { admin } = useMeetingAdmin({
      minutes: [
        { data: existingRow },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-08-06T02:00:00+00:00' } },
      ],
    })
    const res = await POST(post(meetingReq))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      action: 'replaced', meeting_id: MEETING_UUID, meeting_created: true,
    })
    const call = admin.rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')!
    expect((call[1] as { p_metadata: Record<string, unknown> }).p_metadata).toMatchObject({
      meeting_id: MEETING_UUID,
      project_id: PROJECT_UUID,
      meeting_occurrence_date: payload.date,
    })
  })

  it('meeting 미전송 요청의 응답에는 meeting_created 키 자체가 없다 (v2.4 하위호환)', async () => {
    useAdmin({ minutes: [{ data: null }, { data: createdMinute }] })
    const createdRes = await POST(post(payload))
    expect(createdRes.status).toBe(201)
    expect(await createdRes.json()).not.toHaveProperty('meeting_created')

    useAdmin({ minutes: [{ data: existingRow }, { data: createdMinute }] })
    const replacedRes = await POST(post(payload))
    expect(replacedRes.status).toBe(200)
    expect(await replacedRes.json()).not.toHaveProperty('meeting_created')
  })

  it('회의 확보 경로의 조회·insert 실패는 500 — 실패를 없음으로 위장하지 않는다(fail-closed)', async () => {
    useMeetingAdmin({ projects: [{ error: { message: 'down' } }] })
    expect((await POST(post(meetingReq))).status).toBe(500)
    useMeetingAdmin({ project_members: [{ error: { message: 'down' } }] })
    expect((await POST(post(meetingReq))).status).toBe(500)
    useMeetingAdmin({ meetings: [{ error: { message: 'down' } }] })
    expect((await POST(post(meetingReq))).status).toBe(500)
    useMeetingAdmin({ meetings: [{ data: null }, { error: { message: 'down' } }] })
    expect((await POST(post(meetingReq))).status).toBe(500)
  })
})

describe('GET /api/v1/minutes (§5.1, §9.6 ⑪)', () => {
  it('external_id 정확 일치 조회 + url 포함 응답', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [existingRow], count: 1 }] })
    const res = await GET(get(`/api/v1/minutes?external_id=${encodeURIComponent(EXTERNAL_ID)}`))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ total: 1, page: 1, per_page: 20 })
    expect(json.items[0]).toMatchObject({
      id: 'm-1', title: '옛제목', date: '2026-07-01', team: 'PMO',
      external_id: EXTERNAL_ID, created_by_name: '원작성자',
      url: 'http://localhost/minutes/m-1',
    })
    expect(json.items[0]).not.toHaveProperty('body_md')
    expect(builders.minutes[0].eq).toHaveBeenCalledWith('external_id', EXTERNAL_ID)
    expect(builders.minutes[0].select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' })
  })

  it('W24: 기본값은 보관분 제외 — archived_at is null 필터가 걸린다', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [existingRow], count: 1 }] })
    const res = await GET(get('/api/v1/minutes'))
    expect(res.status).toBe(200)
    expect(builders.minutes[0].is).toHaveBeenCalledWith('archived_at', null)
    expect((await res.json()).items[0].archived).toBe(false)
  })

  it('W24: include_archived=true 면 보관 필터를 걸지 않고 archived: true 를 실어 준다 (§9.7 (a))', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: [{ ...existingRow, archived_at: '2026-07-20T00:00:00+00:00' }], count: 1 }],
    })
    const res = await GET(get(
      `/api/v1/minutes?external_id=${encodeURIComponent(EXTERNAL_ID)}&include_archived=true`,
    ))
    expect(res.status).toBe(200)
    expect(builders.minutes[0].is).not.toHaveBeenCalledWith('archived_at', null)
    // 또박또박이 '초기화됨'과 '보관됨'을 구분하는 근거 — 이게 없으면 복구 두 갈래가 둘 다 막힌다
    expect((await res.json()).items[0].archived).toBe(true)
  })

  it('W24: include_archived 는 true/false 만 받는다', async () => {
    expect((await GET(get('/api/v1/minutes?include_archived=1'))).status).toBe(400)
  })

  it('W24: 범위 초과 폴백 카운트 쿼리도 include_archived 를 존중한다', async () => {
    const { builders } = useAdmin({
      minutes: [
        { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
        { count: 7 },
      ],
    })
    const res = await GET(get('/api/v1/minutes?include_archived=true&page=999'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 7 })
    expect(builders.minutes[1].is).not.toHaveBeenCalledWith('archived_at', null)
  })

  it('목록 응답은 본문을 제외한다 — 행에 body_md가 있어도 유출되지 않고 select도 화이트리스트 (§5.1)', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: [{ ...existingRow, body_md: '유출검증본문' }], count: 1 }],
    })
    const res = await GET(get('/api/v1/minutes'))
    expect(JSON.stringify(await res.json())).not.toContain('유출검증본문')
    expect(builders.minutes[0].select).toHaveBeenCalledWith(
      expect.not.stringContaining('body_md'), expect.anything(),
    )
  })

  it('범위 초과 페이지(PostgREST 416/PGRST103)는 500이 아니라 빈 페이지 응답', async () => {
    useAdmin({
      minutes: [
        { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
        { count: 27 },
      ],
    })
    const res = await GET(get('/api/v1/minutes?per_page=20&page=3'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 27, page: 3, per_page: 20 })
  })

  it('linked=false는 external_id 없는 것만 (수동 연결 후보 검색 — §4b)', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?linked=false'))).status).toBe(200)
    expect(builders.minutes[0].is).toHaveBeenCalledWith('external_id', null)
  })

  it('linked=true는 external_id 있는 것만', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?linked=true'))).status).toBe(200)
    expect(builders.minutes[0].not).toHaveBeenCalledWith('external_id', 'is', null)
  })

  it('per_page는 최대 100으로 클램프, 페이지 오프셋 반영', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    const res = await GET(get('/api/v1/minutes?per_page=500&page=2'))
    expect((await res.json()).per_page).toBe(100)
    expect(builders.minutes[0].range).toHaveBeenCalledWith(100, 199)
  })

  it('허용 외 team 필터는 400', async () => {
    expect((await GET(get('/api/v1/minutes?team=QA'))).status).toBe(400)
  })
})

describe('GET /api/v1/minutes/meta (§5.2)', () => {
  it('teams(MDM 포함)·projects·limits 반환, project_id 없으면 meetings 없음', async () => {
    useAdmin({ projects: [{ data: [{ id: 'p-1', name: 'D-CUBE' }] }] })
    const res = await META(get('/api/v1/minutes/meta'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.teams).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
    expect(json.projects).toEqual([{ id: 'p-1', name: 'D-CUBE' }])
    expect(json.limits).toMatchObject({
      max_body_chars: 100_000, max_request_bytes: 4_194_304,
      max_attachments: 10, max_attachment_bytes: 20_971_520,
    })
    expect(json).not.toHaveProperty('meetings')
  })

  it('project_id 지정 시 해당 프로젝트 meetings 포함 — v2.5: category·recurrence 동봉', async () => {
    const { builders } = useAdmin({
      projects: [{ data: [] }],
      meetings: [{
        data: [{
          id: 'mt-1', title: '주간 정례', meeting_date: '2026-07-14',
          category: 'routine', recurrence: 'weekly',
        }],
      }],
    })
    const res = await META(get(`/api/v1/minutes/meta?project_id=${MINUTE_UUID}`))
    const json = await res.json()
    expect(json.meetings).toEqual([{
      id: 'mt-1', title: '주간 정례', date: '2026-07-14', category: 'routine', recurrence: 'weekly',
    }])
    expect(builders.meetings[0].select).toHaveBeenCalledWith('id, title, meeting_date, category, recurrence')
    expect(builders.meetings[0].eq).toHaveBeenCalledWith('project_id', MINUTE_UUID)
  })

  it('project_id가 uuid 형식이 아니면 DB 접근 전에 400', async () => {
    const res = await META(get('/api/v1/minutes/meta?project_id=abc'))
    expect(res.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/minutes/link (§4b, §9.6 ⑩)', () => {
  const linkPayload = { user_email: 'jerry@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }

  it('external_id null 레코드에 부여 → 200 linked (본문·메타 무변경)', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: { id: MINUTE_UUID, external_id: null } }, { data: [{ id: MINUTE_UUID }] }],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, id: MINUTE_UUID, action: 'linked', external_id: EXTERNAL_ID })
    const updated = builders.minutes[1].update.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(updated)).toEqual(['external_id'])
    expect(builders.minutes[1].is).toHaveBeenCalledWith('external_id', null)
  })

  it('이미 같은 값이면 200 — 멱등 재호출 안전', async () => {
    const { builders } = useAdmin({ minutes: [{ data: { id: MINUTE_UUID, external_id: EXTERNAL_ID } }] })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'linked' })
    expect(builders.minutes).toHaveLength(1)
  })

  it('이미 다른 값이면 409 link_conflict — 기존 연결 보호', async () => {
    useAdmin({ minutes: [{ data: { id: MINUTE_UUID, external_id: 'ddobak:다른값' } }] })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'link_conflict' })
  })

  it('external_id가 타 레코드에 사용 중(23505)이면 409 link_conflict', async () => {
    useAdmin({
      minutes: [{ data: { id: MINUTE_UUID, external_id: null } }, { error: { code: '23505', message: 'duplicate' } }],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'link_conflict' })
  })

  it('link 경합: update 0행 후 재조회가 같은 값이면 200 멱등', async () => {
    useAdmin({
      minutes: [
        { data: { id: MINUTE_UUID, external_id: null } },
        { data: [] },
        { data: { external_id: EXTERNAL_ID } },
      ],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'linked' })
  })

  it('link 경합: update 0행 후 재조회가 다른 값이면 409', async () => {
    useAdmin({
      minutes: [
        { data: { id: MINUTE_UUID, external_id: null } },
        { data: [] },
        { data: { external_id: 'ddobak:다른값' } },
      ],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'link_conflict' })
  })

  it('minute_id 불존재는 404 not_found', async () => {
    useAdmin({ minutes: [{ data: null }] })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found' })
  })

  it('minute_id가 uuid 형식이 아니면 DB 접근 전에 400 (§6 형식 오류)', async () => {
    const res = await LINK(link({ ...linkPayload, minute_id: 'm-abc' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('미지 이메일은 403 unknown_user', async () => {
    useAdmin({}, [])
    expect((await LINK(link(linkPayload))).status).toBe(403)
  })

  it('listUsers 실패는 403이 아니라 500', async () => {
    useAdmin({}, [USER], { usersError: true })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'internal_error' })
  })
})

describe('미정의 메서드 은닉 (§3.4 보강 — 405로 존재가 드러나지 않게)', () => {
  it('PUT/DELETE/PATCH/OPTIONS 전부 404', async () => {
    const routes = [
      await import('@/app/api/v1/minutes/route'),
      await import('@/app/api/v1/minutes/meta/route'),
      await import('@/app/api/v1/minutes/link/route'),
    ]
    for (const mod of routes) {
      for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const handler = (mod as Record<string, unknown>)[method]
        expect(handler, `${method} 핸들러 누락`).toBeTypeOf('function')
        const res = await (handler as () => Response | Promise<Response>)()
        expect(res.status).toBe(404)
      }
    }
  })
})
