import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// authz 가드 · admin 클라이언트 · next/cache 3중 모킹(tests/actions/accounts-gate.test.ts 관례).
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient, requireProjectAdmin, getTransport, send, guardThrow } = vi.hoisted(() => {
  const send = vi.fn()
  // 기본 구현은 "여기까지 오면 안 된다"는 함정이다. mockClear 는 구현을 되돌리지 않으므로
  // beforeEach 에서 mockReset 후 이 함정을 다시 깐다 — 안 그러면 앞 테스트의 스텁이 남아
  // 게이트 단언이 조용히 무력화되고, 반대로 함정이 남아 성공 경로가 catch 로 떨어진다.
  const guardThrow = (): never => {
    throw new Error('createAdminClient 는 게이트/입력 검증을 통과하기 전에 호출되면 안 된다')
  }
  return {
    createAdminClient: vi.fn(guardThrow),
    requireProjectAdmin: vi.fn(),
    getTransport: vi.fn(() => ({ ok: true, send })),
    send,
    guardThrow,
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))
// 팀 마스터는 모듈 로드 시 DB 를 읽는다(캐시 프라이밍). 여기서는 코드 검증 규칙만 필요하므로
// 실물을 태우지 않는다 — 태우면 TTL 만료 시점에 createAdminClient 호출 단언이 흔들린다.
vi.mock('@/lib/teams/master', () => ({
  activeTeamCodesForProjectSync: () => ['PMO', 'ERP', 'MES', '가공', 'MDM'],
}))
vi.mock('@/lib/data/accounts', () => ({ listAllAuthUsers: vi.fn(async () => []) }))

import { revalidatePath } from 'next/cache'
import {
  listProjectInvites, createProjectInvite, revokeProjectInvite,
} from '@/app/actions/projectInvites'

const P1 = 'p1'
const DENIED = { ok: false as const, error: '권한 없음' }
const adminActor = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map([[P1, 'admin' as const]]),
}
const VALID = { email: 'nam.yu@dongkuk.com', teamCode: 'PMO' }

const APP_URL = 'https://dflow.example.com'
const DAY_MS = 24 * 60 * 60 * 1000
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL
const originalDomains = process.env.INVITE_ALLOWED_DOMAINS

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(guardThrow)
  requireProjectAdmin.mockReset()
  getTransport.mockClear()
  send.mockReset()
  vi.mocked(revalidatePath).mockClear()
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
  delete process.env.INVITE_ALLOWED_DOMAINS
})

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
  if (originalDomains === undefined) delete process.env.INVITE_ALLOWED_DOMAINS
  else process.env.INVITE_ALLOWED_DOMAINS = originalDomains
})

/** update(...).eq().eq().is().is().select('id') 체인 — 취소 경로가 쓰는 형태 그대로. */
function revokeClient(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(async () => result),
  }
  const update = vi.fn(() => chain)
  return { client: { from: vi.fn(() => ({ update })) }, update, chain }
}

type QueryResult = { data: unknown; error: { code?: string; message: string } | null }

/** PostgREST 빌더 흉내 — 어떤 순서로 체이닝해도 자신을 돌려주고, await 하면 결과를 낸다.
 *  (빌더는 thenable 이므로 .single() 없이 await 하는 호출부도 있다 — 중복 초대 조회가 그렇다.) */
interface Chain {
  select: (...a: unknown[]) => Chain
  eq: (...a: unknown[]) => Chain
  is: (...a: unknown[]) => Chain
  in: (...a: unknown[]) => Chain
  or: (...a: unknown[]) => Chain
  order: (...a: unknown[]) => Chain
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>
}
function chainOf(result: QueryResult): Chain {
  const chain: Chain = {
    select: () => chain, eq: () => chain, is: () => chain, in: () => chain, or: () => chain, order: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  }
  return chain
}

const INSERTED_ID = 'inv-1'

/**
 * createProjectInvite 가 훑는 경로 전부를 흉내낸 admin 스텁 —
 * projects 조회 → teams 조회 → 중복 초대 조회 → insert → 초대자 조회.
 * insert 는 받은 payload 를 그대로 돌려준다(DB 의 returning 과 같은 형태).
 */
function createClient(o: {
  blocking?: Record<string, unknown>[]
  blockingError?: { message: string } | null
  insertError?: { code?: string; message: string } | null
  /** resolveTeamId 의 teams 조회 응답을 덮어쓴다 — 동명 2행(전역+프로젝트) 우선순위 검증용. */
  teamsRows?: Array<{ id: string; project_id: string | null }>
} = {}) {
  const insert = vi.fn((payload: Record<string, unknown>) => chainOf({
    data: o.insertError ? null : {
      id: INSERTED_ID, token: payload.token, email: payload.email,
      created_at: new Date().toISOString(), expires_at: payload.expires_at,
      revoked_at: null, redeemed_at: null,
    },
    error: o.insertError ?? null,
  }))
  // 자동 정리를 걷어냈으므로 중복 검사 경로는 project_invites 를 읽기만 해야 한다.
  const update = vi.fn(() => chainOf({ data: [], error: null }))
  const del = vi.fn(() => chainOf({ data: [], error: null }))

  const from = vi.fn((table: string) => {
    if (table === 'projects') return chainOf({ data: { name: 'D-CUBE' }, error: null })
    // resolveTeamId 는 .single() 없이 배열로 받는다(0071 스코프 — 프로젝트 행 우선, 전역 폴백).
    if (table === 'teams') {
      return chainOf({ data: o.teamsRows ?? [{ id: 'team-1', project_id: null }], error: null })
    }
    return {
      ...chainOf({ data: o.blockingError ? null : (o.blocking ?? []), error: o.blockingError ?? null }),
      insert, update, delete: del,
    }
  })
  const getUserById = vi.fn(async () => ({
    data: { user: { id: 'u1', email: 'pmo@dongkuk.com', user_metadata: { full_name: '초대자' } } },
    error: null,
  }))
  return {
    client: { from, auth: { admin: { getUserById } } },
    from, insert, update, del,
  }
}

/** insert 에 실제로 실린 payload. 성공 경로 단언의 기준점이다. */
function insertedPayload(insert: ReturnType<typeof createClient>['insert']) {
  return insert.mock.calls[0]![0]
}

describe('초대 서버액션 권한 게이트', () => {
  it('프로젝트 관리자가 아니면 listProjectInvites 거부 — admin client 미생성', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await listProjectInvites(P1)
    // 권한 거부를 빈 목록으로 위장하면 '아직 안 보냈구나'로 읽혀 재발급을 유발한다.
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자가 아니면 createProjectInvite 거부 — admin client·메일 모두 미도달', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자가 아니면 revokeProjectInvite 거부 — admin client 미생성', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await revokeProjectInvite(P1, 'i1')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회 실패도 세 함수 모두 중단한다 — 관대한 폴백 금지', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await listProjectInvites(P1)).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await createProjectInvite(P1, VALID)).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await revokeProjectInvite(P1, 'i1')).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createProjectInvite 입력 검증 — 저장 전에 막는다', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
  })

  it('사외 도메인은 초대를 만들지 않는다', async () => {
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@gmail.com' })
    expect(res).toEqual({ ok: false, error: '사내 이메일 주소(@dongkuk.com)로만 초대할 수 있습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  // 서브도메인 사칭('dongkuk.com.evil.io')이 허용 도메인으로 통과하면 화이트리스트가 무의미하다.
  it('허용 도메인을 접두로 가진 사칭 주소도 거부한다', async () => {
    const res = await createProjectInvite(P1, { ...VALID, email: 'a@dongkuk.com.evil.io' })
    expect(res).toMatchObject({ ok: false, error: '사내 이메일 주소(@dongkuk.com)로만 초대할 수 있습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  // 문구를 하드코딩하면 다른 도메인을 설정한 배포에서 관리자가 거짓 안내를 받는다.
  it('거부 문구는 설정된 허용 도메인 목록으로 조립한다', async () => {
    process.env.INVITE_ALLOWED_DOMAINS = 'dongkuk.com, dkgroup.co.kr'
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@gmail.com' })
    expect(res).toEqual({
      ok: false, error: '사내 이메일 주소(@dongkuk.com, @dkgroup.co.kr)로만 초대할 수 있습니다.',
    })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('대문자·공백이 섞인 사내 주소는 정규화 후 도메인 검사를 통과한다', async () => {
    // 정규화가 도메인 검사보다 먼저 일어나는지 — 그리고 저장되는 값도 정규화된 것인지 확인한다.
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await createProjectInvite(P1, { ...VALID, email: '  NAM.YU@Dongkuk.com ' })
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert).email).toBe('nam.yu@dongkuk.com')
  })

  it('이메일 형식이 깨지면 거부한다', async () => {
    const res = await createProjectInvite(P1, { ...VALID, email: 'broken-email' })
    expect(res).toEqual({ ok: false, error: '이메일 형식을 확인해 주세요.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('알 수 없는 팀 코드는 거부한다', async () => {
    const res = await createProjectInvite(P1, { ...VALID, teamCode: '없는팀' })
    expect(res).toEqual({ ok: false, error: '알 수 없는 팀 코드' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('유효기간이 범위를 벗어나면 거부한다(0·31·비정수)', async () => {
    for (const days of [0, 31, 7.5, -1]) {
      createAdminClient.mockClear()
      const res = await createProjectInvite(P1, { ...VALID, days })
      expect(res).toEqual({ ok: false, error: '유효기간은 1~30일 사이여야 합니다.' })
      expect(createAdminClient).not.toHaveBeenCalled()
    }
  })

  it('유효기간 미지정은 기본값(7일)으로 통과한다 — 경계(1·30)도 통과', async () => {
    for (const [days, expected] of [[undefined, 7], [1, 1], [30, 30]] as const) {
      const { client, insert } = createClient()
      createAdminClient.mockReturnValue(client as never)
      send.mockResolvedValue({ rejected: [] })
      const t0 = Date.now()
      const res = await createProjectInvite(P1, { ...VALID, days })
      expect(res).toMatchObject({ ok: true })
      // 통과 여부만 보면 '검증을 통과했다'와 '저장까지 됐다'가 구분되지 않는다 — 실제 만료 시각을 본다.
      const delta = new Date(String(insertedPayload(insert).expires_at)).getTime() - t0
      expect(delta).toBeGreaterThan(expected * DAY_MS - 5000)
      expect(delta).toBeLessThan(expected * DAY_MS + 5000)
    }
  })

  // 틀린 origin 의 링크는 발송되고 나면 회수할 수 없다 — 만들지 않는 편이 낫다(fail-closed).
  it('NEXT_PUBLIC_APP_URL 이 없으면 초대를 만들지 않는다', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('공백뿐인 NEXT_PUBLIC_APP_URL 도 미설정으로 본다', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   '
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createProjectInvite 성공 경로 — 저장·링크·메일', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
    send.mockResolvedValue({ rejected: [] })
  })

  it('정상 발급: insert 페이로드·링크·메일 1통', async () => {
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)

    const res = await createProjectInvite(P1, VALID)
    expect(res).toMatchObject({ ok: true, mailed: true })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith({
      project_id: P1,
      token: expect.any(String),
      email: 'nam.yu@dongkuk.com',
      team_id: 'team-1',
      created_by: adminActor.userId,
      expires_at: expect.any(String),
    })
    // 링크는 서버가 조립한다 — UI 가 window.location.origin 을 읽으면 프리렌더에서 죽는다.
    const token = String(insertedPayload(insert).token)
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.url).toBe(`${APP_URL}/invite/${token}`)
    expect(res.row.url).toBe(`${APP_URL}/invite/${token}`)
    expect(send).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/settings`)
  })

  // 0071 회귀: 같은 code 로 전역+프로젝트 행이 동시에 존재해도(복합 유니크가 허용하는 상태)
  // resolveTeamId 는 프로젝트 행을 고른다 — 이 태스크(스코프 소탕)의 존재 이유 자체를 검증한다.
  it('같은 팀 code 의 전역·프로젝트 행 2개 중 프로젝트 행을 선택한다', async () => {
    const { client, insert } = createClient({
      teamsRows: [
        { id: 'team-global', project_id: null },
        { id: 'team-proj', project_id: P1 },
      ],
    })
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert).team_id).toBe('team-proj')
  })

  // 토큰은 초대 링크 그 자체다. UI 가 읽지도 않는 필드로 전 초대의 원본 토큰이
  // RSC 페이로드에 실려 브라우저까지 가면, 목록을 볼 수 있는 사람이 곧 전부의 열쇠를 갖는다.
  it('반환 행에 원본 토큰을 싣지 않는다', async () => {
    const { client } = createClient()
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.row).not.toHaveProperty('token')
    expect(Object.keys(res.row).sort()).toEqual(
      ['createdAt', 'email', 'expiresAt', 'id', 'redeemedAt', 'status', 'teamCode', 'url'],
    )
  })

  it('활성 초대가 있으면 insert 에 닿지 않고 거부한다', async () => {
    const { client, insert } = createClient({
      blocking: [{
        id: 'i0', expires_at: new Date(Date.now() + DAY_MS).toISOString(),
        revoked_at: null, redeemed_at: null,
      }],
    })
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '이 주소로 발급한 초대가 아직 유효합니다. 취소 후 다시 보내세요.' })
    expect(insert).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  // 만료분을 자동 소프트 취소하면 아무도 취소하지 않은 초대가 '취소됨'으로 남아
  // 소프트 취소를 감사 근거로 삼은 설계(P5)가 무너진다 — 관리자가 직접 취소하게 한다.
  it('만료된 초대가 남아 있으면 자동 취소하지 않고 안내한다', async () => {
    const { client, insert, update, del } = createClient({
      blocking: [{
        id: 'i0', expires_at: new Date(Date.now() - DAY_MS).toISOString(),
        revoked_at: null, redeemed_at: null,
      }],
    })
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '이 주소로 발급한 초대가 남아 있습니다. 목록에서 취소한 뒤 다시 보내세요.' })
    expect(update).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  // 메일이 실패해도 링크는 이미 유효하다. 행을 지우면 관리자에게는 '아무 일도 없었다'로 보이지만
  // SMTP 는 부분 성공을 내므로 메일이 이미 나갔을 수도 있다.
  it('메일 발송이 실패해도 초대는 살아 있다 — ok:true, mailed:false', async () => {
    const { client, insert, update, del } = createClient()
    createAdminClient.mockReturnValue(client as never)
    send.mockRejectedValue(new Error('smtp down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createProjectInvite(P1, VALID)
    spy.mockRestore()

    expect(res).toMatchObject({ ok: true, mailed: false, mailError: '메일 발송 중 오류가 발생했습니다.' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.row.id).toBe(INSERTED_ID)
    expect(res.url).toContain('/invite/')
  })
})

describe('revokeProjectInvite — 소프트 취소', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
  })

  it('영향 행이 0이면 실패로 보고한다 — 조용한 no-op 을 성공으로 위장하지 않는다', async () => {
    const { client, chain } = revokeClient({ data: [], error: null })
    createAdminClient.mockReturnValue(client as never)
    const res = await revokeProjectInvite(P1, 'i1')
    expect(res).toEqual({ ok: false, error: '취소할 수 있는 초대가 아닙니다.' })
    // .select('id') 없이는 0행과 1행이 구분되지 않는다.
    expect(chain.select).toHaveBeenCalledWith('id')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('행을 지우지 않고 revoked_at 만 채운다 — 합류 이력 보존', async () => {
    const { client, update, chain } = revokeClient({ data: [{ id: 'i1' }], error: null })
    createAdminClient.mockReturnValue(client as never)
    const res = await revokeProjectInvite(P1, 'i1')
    expect(res).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
    // 이미 합류·이미 취소된 초대는 대상이 아니다(is(...) 두 번) + 타 프로젝트 차단(eq 두 번).
    expect(chain.is).toHaveBeenCalledWith('redeemed_at', null)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
    expect(chain.eq).toHaveBeenCalledWith('project_id', P1)
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/settings`)
  })

  // 만료분이 부분 유니크를 막고 있으므로, 만료 초대를 취소할 수 없으면 같은 주소로 다시 보낼
  // 길이 영영 없다(발급 경로는 더 이상 자동으로 치워주지 않는다).
  it('만료된 초대도 취소 대상이다 — expires_at 조건을 걸지 않는다', async () => {
    const { client, chain } = revokeClient({ data: [{ id: 'i1' }], error: null })
    createAdminClient.mockReturnValue(client as never)
    expect(await revokeProjectInvite(P1, 'i1')).toEqual({ ok: true })
    // 좁히는 조건은 넷뿐 — id·project_id(eq) + 미합류·미취소(is). 만료 여부는 보지 않는다.
    expect(chain.eq).toHaveBeenCalledTimes(2)
    expect(chain.is).toHaveBeenCalledTimes(2)
  })

  it('취소 쿼리가 실패하면 원시 메시지를 노출하지 않고 중단한다', async () => {
    const { client } = revokeClient({ data: null, error: { message: 'permission denied for table project_invites' } })
    createAdminClient.mockReturnValue(client as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await revokeProjectInvite(P1, 'i1')
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })
})
