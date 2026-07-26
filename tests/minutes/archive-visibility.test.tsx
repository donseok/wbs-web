import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
}))
vi.mock('@/components/minutes/ShareViewer', () => ({
  ShareViewer: () => null,
}))

import SharedMinutePage from '@/app/share/minutes/[token]/page'
import { searchMinutes } from '@/lib/data/minutes'

type QueryResult = {
  data: unknown
  error: { message: string } | null
}

function thenableQuery(result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: QueryResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {}
  for (const method of ['select', 'eq', 'is', 'or', 'order', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

function singleQuery(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.is.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue(result)
  return query
}

describe('보관된 회의록 노출 차단', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('일반 회의록 검색은 archived_at이 null인 행으로 제한한다', async () => {
    const query = thenableQuery({ data: [], error: null })
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        expect(table).toBe('minutes')
        return query
      }),
    })

    await expect(searchMinutes('보관 대상', null, 20)).resolves.toEqual([])

    expect(query.is).toHaveBeenCalledWith('archived_at', null)
    expect(query.or).toHaveBeenCalledWith(
      'title.ilike."%보관 대상%",body_md.ilike."%보관 대상%"',
    )
  })

  it('공유 페이지는 enabled token뿐 아니라 archived_at null을 함께 요구한다', async () => {
    const token = '3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d'
    const query = singleQuery({
      data: {
        minute_date: '2026-07-25',
        team_code: 'ERP',
        title: '공유 가능한 회의록',
        body_md: '본문',
      },
      error: null,
    })
    const from = vi.fn(() => query)
    mocks.createAdminClient.mockReturnValue({ from })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')

    await expect(SharedMinutePage({
      params: Promise.resolve({ token }),
    })).resolves.toBeTruthy()

    expect(from).toHaveBeenCalledWith('minutes')
    expect(query.select).toHaveBeenCalledWith('minute_date, team_code, title, body_md')
    expect(query.eq).toHaveBeenCalledWith('share_token', token)
    expect(query.eq).toHaveBeenCalledWith('share_enabled', true)
    expect(query.is).toHaveBeenCalledWith('archived_at', null)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('archive RPC는 공유를 끄고 검색 파생물을 제거하되 share token과 원본은 보존한다', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0045_minutes_wiki.sql'),
      'utf8',
    )
    const start = migration.indexOf(
      'create or replace function public.archive_minute_with_wiki_retraction',
    )
    const end = migration.indexOf(
      'revoke all on function public.archive_minute_with_wiki_retraction',
      start,
    )
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const archiveRpc = migration.slice(start, end)

    expect(archiveRpc).toMatch(/share_enabled\s*=\s*false/)
    expect(archiveRpc).toMatch(
      /delete from public\.minute_embeddings\s+where minute_id = p_minute_id;/,
    )
    expect(archiveRpc).toMatch(
      /delete from public\.ai_documents\s+where domain = 'minutes'/,
    )
    expect(archiveRpc).toMatch(
      /select job\.project_id[\s\S]*from public\.ai_index_jobs job[\s\S]*union all\s+select v_minute\.project_id/,
    )
    expect(archiveRpc).toMatch(
      /perform public\.queue_minute_ai_index_scope_change\(\s*v_index_project_id,\s*p_minute_id,\s*'delete'/,
    )
    expect(archiveRpc).not.toMatch(/share_token\s*=/)
    expect(archiveRpc).not.toMatch(/delete from public\.minute_versions/)
    expect(archiveRpc).not.toMatch(/delete from public\.minute_files/)
  })
})
