import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
import { createAdminClient } from '@/lib/supabase/admin'
import { pgErrorCode, isSchemaMissing, dkbotHealth, dkbotIndexStatus } from '@/lib/ai/health'

const mockedCreate = vi.mocked(createAdminClient)

/** wbs_embeddings/wbs_items 쿼리 빌더 가짜(체이닝 + then + maybeSingle). */
function tableChain(awaited: unknown, single: unknown) {
  const b: Record<string, unknown> = {}
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve(single),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(awaited).then(res, rej),
  })
  return b
}

describe('pgErrorCode / isSchemaMissing', () => {
  it('PostgREST 에러 객체에서 코드를 뽑는다', () => {
    expect(pgErrorCode({ code: '42P01' })).toBe('42P01')
    expect(pgErrorCode(new Error('x'))).toBeUndefined()
    expect(pgErrorCode(null)).toBeUndefined()
  })

  it('테이블/함수/타입 부재 코드는 마이그레이션 미적용으로 판정', () => {
    expect(isSchemaMissing({ code: '42P01' })).toBe(true) // undefined_table
    expect(isSchemaMissing({ code: '42883' })).toBe(true) // undefined_function
    expect(isSchemaMissing({ code: '42704' })).toBe(true) // undefined_object(type)
  })

  it('메시지에 객체명 + "존재하지 않음"이 함께 있으면 미적용으로 판정', () => {
    expect(isSchemaMissing(new Error('relation "public.wbs_embeddings" does not exist'))).toBe(true)
    expect(isSchemaMissing({ message: 'function match_wbs_documents does not exist' })).toBe(true)
  })

  it('무관한 에러는 미적용으로 오판하지 않는다', () => {
    expect(isSchemaMissing({ code: '23505' })).toBe(false) // unique_violation
    expect(isSchemaMissing(new Error('네트워크 시간 초과'))).toBe(false)
    expect(isSchemaMissing(null)).toBe(false)
  })

  it('대상 객체 패턴을 넘기면 그 객체의 부재만 잡는다(0030 briefs 프로브 규칙)', () => {
    const pgrst205 = { code: 'PGRST205', message: "Could not find the table 'public.project_ai_briefs' in the schema cache" }
    expect(isSchemaMissing(pgrst205, /project_ai_briefs/i)).toBe(true)
    // 기본(pgvector 계열) 패턴으로는 briefs 부재를 미적용으로 판정하지 않는다 — 상태 축 분리
    expect(isSchemaMissing(pgrst205)).toBe(false)
  })
})

describe('dkbotHealth', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
    vi.stubEnv('AI_PROVIDER', '')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GOOGLE_API_KEY', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  /** dkbotHealth 용 가짜 admin — RPC(0010)와 briefs 테이블(0030) 프로브 결과를 개별 지정. */
  function fakeHealthAdmin(
    rpcResult: { data: unknown; error: unknown },
    briefsResult: { count: number | null; error: unknown } = { count: 0, error: null },
  ) {
    return {
      rpc: vi.fn(async () => rpcResult),
      from: vi.fn(() => tableChain(briefsResult, null)),
    }
  }

  it('service_role 미설정이면 schema/briefs=no_service_role', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const h = await dkbotHealth()
    expect(h.serviceRole).toBe(false)
    expect(h.schema).toBe('no_service_role')
    expect(h.briefs).toBe('no_service_role')
    expect(h.llm).toBe(true)
    expect(h.embeddings).toBe(true)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('RPC·briefs 프로빙 모두 성공이면 schema/briefs=ready', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc')
    const admin = fakeHealthAdmin({ data: [], error: null })
    mockedCreate.mockReturnValue(admin as never)
    const h = await dkbotHealth()
    expect(h.schema).toBe('ready')
    expect(h.briefs).toBe('ready')
    expect(admin.rpc).toHaveBeenCalledWith('match_wbs_documents', expect.objectContaining({ match_count: 1 }))
    expect(admin.from).toHaveBeenCalledWith('project_ai_briefs')
  })

  it('RPC 가 테이블 부재 에러면 schema=missing (briefs 는 독립적으로 ready)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc')
    mockedCreate.mockReturnValue(
      fakeHealthAdmin({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) as never,
    )
    const h = await dkbotHealth()
    expect(h.schema).toBe('missing')
    expect(h.briefs).toBe('ready')
  })

  it('briefs 테이블 부재(PGRST205)면 briefs=missing (schema 는 독립적으로 ready)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc')
    mockedCreate.mockReturnValue(
      fakeHealthAdmin(
        { data: [], error: null },
        { count: null, error: { code: 'PGRST205', message: "Could not find the table 'public.project_ai_briefs' in the schema cache" } },
      ) as never,
    )
    const h = await dkbotHealth()
    expect(h.schema).toBe('ready')
    expect(h.briefs).toBe('missing')
    expect(h.detail).toContain('project_ai_briefs')
  })
})

describe('dkbotIndexStatus', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
    vi.stubEnv('AI_PROVIDER', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc')
  })
  afterEach(() => vi.unstubAllEnvs())

  function fakeAdmin(cfg: {
    embCount: number | null
    embErr?: unknown
    embLatest?: string | null
    itemCount: number | null
    itemLatest?: string | null
  }) {
    return {
      from: (table: string) =>
        table === 'wbs_embeddings'
          ? tableChain(
              { count: cfg.embCount, error: cfg.embErr ?? null },
              { data: cfg.embLatest ? { updated_at: cfg.embLatest } : null, error: null },
            )
          : tableChain(
              { count: cfg.itemCount, error: null },
              { data: cfg.itemLatest ? { updated_at: cfg.itemLatest } : null, error: null },
            ),
    }
  }

  it('임베딩 키 없고 service_role 도 없으면 disabled', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const s = await dkbotIndexStatus('p1')
    expect(s.freshness).toBe('disabled')
  })

  it('색인이 WBS 보다 최신이면 fresh', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    mockedCreate.mockReturnValue(
      fakeAdmin({ embCount: 5, embLatest: '2026-01-02T00:00:00Z', itemCount: 5, itemLatest: '2026-01-01T00:00:00Z' }) as never,
    )
    const s = await dkbotIndexStatus('p1')
    expect(s.freshness).toBe('fresh')
    expect(s.indexed).toBe(5)
  })

  it('WBS 가 색인보다 나중에 변경됐으면 stale', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    mockedCreate.mockReturnValue(
      fakeAdmin({ embCount: 5, embLatest: '2026-01-01T00:00:00Z', itemCount: 5, itemLatest: '2026-02-01T00:00:00Z' }) as never,
    )
    const s = await dkbotIndexStatus('p1')
    expect(s.freshness).toBe('stale')
  })

  it('항목은 있는데 색인이 0이면 stale', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    mockedCreate.mockReturnValue(fakeAdmin({ embCount: 0, itemCount: 7, itemLatest: '2026-01-01T00:00:00Z' }) as never)
    const s = await dkbotIndexStatus('p1')
    expect(s.freshness).toBe('stale')
  })

  it('WBS 항목이 없으면 empty', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    mockedCreate.mockReturnValue(fakeAdmin({ embCount: 0, itemCount: 0 }) as never)
    const s = await dkbotIndexStatus('p1')
    expect(s.freshness).toBe('empty')
  })

  it('테이블 부재 에러면 schema_missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    mockedCreate.mockReturnValue(
      fakeAdmin({ embCount: null, embErr: { code: '42P01', message: 'no table' }, itemCount: 3 }) as never,
    )
    const s = await dkbotIndexStatus('p1')
    expect(s.freshness).toBe('schema_missing')
  })
})
