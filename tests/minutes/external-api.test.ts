import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  ingestMinute: vi.fn(async () => {}),
  generateMinuteInsights: vi.fn(async () => {}),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: mocks.ingestMinute }))
vi.mock('@/lib/ai/minutes-insights', () => ({ generateMinuteInsights: mocks.generateMinuteInsights }))
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
const USER = { id: 'u-1', email: 'jerry@example.com', user_metadata: { full_name: '팀장' } }

type QueryResponse = {
  data?: unknown
  error?: { message?: string; code?: string } | null
  count?: number | null
}

/** thenable query builder — 체인 메서드 전부 builder 반환, await 시 응답 resolve (index-worker 테스트 관례). */
function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'is', 'not',
    'gte', 'lte', 'in', 'or', 'order', 'range', 'limit', 'maybeSingle', 'single',
  ]) builder[method] = vi.fn(() => builder)
  builder.then = (resolve, reject) =>
    Promise.resolve({
      data: response.data ?? null,
      error: response.error ?? null,
      count: response.count ?? null,
    }).then(resolve, reject)
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
      const b = queryBuilder((tables[table] ?? []).shift() ?? { data: null, error: null })
      ;(builders[table] ??= []).push(b)
      return b
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
  meeting_id: null,
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
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  vi.stubEnv('MINUTES_API_SECRET', SECRET)
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
    const { builders } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-9', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, user_email: '  Jerry@Example.COM ' }))
    expect(res.status).toBe(201)
    expect(builders.minutes).toHaveLength(2)
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
    const { builders } = useAdmin({
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
    const inserted = builders.minutes[1].insert.mock.calls[0][0] as Record<string, unknown>
    expect(inserted).toMatchObject({
      minute_date: payload.date, team_code: 'PMO', title: payload.title,
      body_md: payload.body_markdown, external_id: EXTERNAL_ID,
      created_by: 'u-1', created_by_name: '팀장',
    })
    expect(mocks.afterCallbacks).toHaveLength(1)
    await runAfterCallbacks()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.generateMinuteInsights).toHaveBeenCalledWith('m-1', payload.body_markdown)
  })

  it('같은 external_id 재전송(기본 replace)은 200 replaced — D3 범위만 갱신, 소유권 불변', async () => {
    const { builders } = useAdmin({
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
    const updated = builders.minutes[1].update.mock.calls[0][0] as Record<string, unknown>
    expect(updated).toMatchObject({
      minute_date: payload.date, team_code: 'PMO', title: payload.title,
      body_md: payload.body_markdown,
    })
    expect(updated).toHaveProperty('updated_at')
    // §0 D3 — 소유권·멱등키는 갱신 범위 밖, meeting_id는 미전송이므로 유지(v2.2)
    expect(Object.keys(updated)).not.toContain('created_by')
    expect(Object.keys(updated)).not.toContain('created_by_name')
    expect(Object.keys(updated)).not.toContain('external_id')
    expect(Object.keys(updated)).not.toContain('meeting_id')
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
    const { builders } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-3', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, body_markdown: ddobakBody }))
    expect(res.status).toBe(201)
    const inserted = builders.minutes[1].insert.mock.calls[0][0] as Record<string, unknown>
    expect(inserted.body_md).toBe(ddobakBody)
    expect(inserted.body_md).toContain('14:00 ~ 15:10')
  })

  it('replace 경로도 4마커 본문을 무보정으로 저장한다 (§9.6 ⑨ — 또박또박 일상 흐름은 재전송)', async () => {
    const ddobakBody = [
      '# 물류공정_260716', '',
      '- **날짜**: 2026-07-16',
      '- **시간**: 14:00 ~ 15:10',
      '- **상태**: 완료',
      '- **생성자**: jjinie73@gmail.com',
    ].join('\n')
    const { builders } = useAdmin({
      minutes: [{ data: existingRow }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, body_markdown: ddobakBody }))
    expect(res.status).toBe(200)
    const updated = builders.minutes[1].update.mock.calls[0][0] as Record<string, unknown>
    expect(updated.body_md).toBe(ddobakBody)
    expect(updated.body_md).toContain('14:00 ~ 15:10')
  })

  it('meeting_id가 존재하면 201 — 값이 저장·응답에 전파된다 (§4.2 프로젝트 연결 유일 경로)', async () => {
    const { builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID } }],
      minutes: [{ data: null }, { data: { id: 'm-5', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    expect((await res.json()).meeting_id).toBe(MEETING_UUID)
    expect((builders.minutes[1].insert.mock.calls[0][0] as Record<string, unknown>).meeting_id).toBe(MEETING_UUID)
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
    let updated = fake.builders.minutes[1].update.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(updated)).not.toContain('meeting_id')
    // 명시적 null → 해제
    fake = useAdmin({
      minutes: [{ data: withMeeting }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    res = await POST(post({ ...payload, meeting_id: null }))
    expect(res.status).toBe(200)
    expect((await res.json()).meeting_id).toBeNull()
    updated = fake.builders.minutes[1].update.mock.calls[0][0] as Record<string, unknown>
    expect(updated.meeting_id).toBeNull()
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

  it('project_id 지정 시 해당 프로젝트 meetings 포함', async () => {
    const { builders } = useAdmin({
      projects: [{ data: [] }],
      meetings: [{ data: [{ id: 'mt-1', title: '주간 정례', meeting_date: '2026-07-14' }] }],
    })
    const res = await META(get(`/api/v1/minutes/meta?project_id=${MINUTE_UUID}`))
    const json = await res.json()
    expect(json.meetings).toEqual([{ id: 'mt-1', title: '주간 정례', date: '2026-07-14' }])
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
