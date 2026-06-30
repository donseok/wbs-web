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
})

describe('dkbotHealth', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
    vi.stubEnv('AI_PROVIDER', '')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GOOGLE_API_KEY', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('service_role 미설정이면 schema=no_service_role', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const h = await dkbotHealth()
    expect(h.serviceRole).toBe(false)
    expect(h.schema).toBe('no_service_role')
    expect(h.llm).toBe(true)
    expect(h.embeddings).toBe(true)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('RPC 프로빙 성공이면 schema=ready', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc')
    const rpc = vi.fn(async () => ({ data: [], error: null }))
    mockedCreate.mockReturnValue({ rpc } as never)
    const h = await dkbotHealth()
    expect(h.schema).toBe('ready')
    expect(rpc).toHaveBeenCalledWith('match_wbs_documents', expect.objectContaining({ match_count: 1 }))
  })

  it('RPC 가 테이블 부재 에러면 schema=missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc')
    mockedCreate.mockReturnValue({
      rpc: vi.fn(async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } })),
    } as never)
    const h = await dkbotHealth()
    expect(h.schema).toBe('missing')
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
