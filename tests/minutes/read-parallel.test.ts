import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 회의록 데이터 계층 직렬 왕복 축소(병렬화) 회귀 테스트.
 *
 * - getMinuteDetail: 본문/파일 목록을 병렬 요청(2단→1단)하되, 본문 실패=throw ·
 *   본문 부재=null(파일 결과 폐기) · 파일 실패=로깅 후 빈 목록이라는 기존 계약을 유지한다.
 * - getMinuteWikiImpact: job/변경 이력을 병렬 요청(3단→2단)하되, job 실패=fallback ·
 *   변경 이력 실패=job 파생 status/counts 반환 계약을 유지한다. wiki_items 조회는
 *   changes 결과(itemIds)에 의존하므로 여전히 뒤 단계다.
 */

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

import { getMinuteDetail, getMinuteWikiImpact } from '@/lib/data/minutes'

type QueryResult = { data: unknown; error: { message: string } | null }

function deferred() {
  let resolve!: (v: QueryResult) => void
  const promise = new Promise<QueryResult>(res => { resolve = res })
  return { promise, resolve }
}

/** 체인 어느 지점에서 await 해도 동작하는 thenable 빌더(결과는 지연 주입 가능). */
function queryBuilder(result: QueryResult | Promise<QueryResult>) {
  const source = Promise.resolve(result)
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const method of ['select', 'eq', 'in', 'is', 'or', 'not', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => source)
  builder.then = (res, rej) => source.then(res, rej)
  return builder
}

const MINUTE_ROW = {
  id: 'min-1', minute_date: '2026-08-01', team_code: 'ERP', title: '설계 회의',
  body_md: '# 본문', meeting_id: 'meet-1', project_id: 'p1',
  meeting_occurrence_date: null, archived_at: null, external_id: null,
  created_by: 'u1', created_by_name: '홍길동',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T01:00:00Z',
  folder_id: null, meetings: { project_id: 'p1' }, projects: { name: '프로젝트1' },
}

const FILE_ROW = {
  id: 'f1', minute_id: 'min-1', role: 'attachment', file_name: '자료.pdf',
  file_path: 'minutes/min-1/자료.pdf', size: 1024, mime: 'application/pdf',
  created_at: '2026-08-01T02:00:00Z',
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  vi.unstubAllEnvs()
})

describe('getMinuteDetail — 본문/파일 병렬화', () => {
  it('본문 응답을 기다리지 않고 파일 쿼리를 함께 시작한다(직렬 2단 → 1단)', async () => {
    const body = deferred()
    const minuteQ = queryBuilder(body.promise)
    const filesQ = queryBuilder({ data: [FILE_ROW], error: null })
    const from = vi.fn((table: string) => (table === 'minutes' ? minuteQ : filesQ))
    mocks.createServerClient.mockResolvedValue({ from })

    const pending = getMinuteDetail('min-1')
    // 본문 결과가 아직 미해소인 시점에 파일 테이블 조회가 이미 시작됐어야 한다.
    await vi.waitFor(() => expect(from).toHaveBeenCalledWith('minute_files'))
    expect(from).toHaveBeenCalledWith('minutes')

    body.resolve({ data: MINUTE_ROW, error: null })
    const result = await pending
    expect(result?.minute).toMatchObject({ id: 'min-1', bodyMd: '# 본문', meetingProjectId: 'p1' })
    expect(result?.files).toEqual([{
      id: 'f1', minuteId: 'min-1', role: 'attachment', fileName: '자료.pdf',
      filePath: 'minutes/min-1/자료.pdf', size: 1024, mime: 'application/pdf',
      createdAt: '2026-08-01T02:00:00Z',
    }])
  })

  it('본문 조회 실패는 파일 조회가 성공해도 여전히 throw 한다(행 없음으로 위장 금지)', async () => {
    const minuteQ = queryBuilder({ data: null, error: { message: 'boom' } })
    const filesQ = queryBuilder({ data: [FILE_ROW], error: null })
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => (table === 'minutes' ? minuteQ : filesQ)),
    })

    await expect(getMinuteDetail('min-1')).rejects.toThrow('[getMinuteDetail] 조회 실패: boom')
  })

  it('본문이 없으면 파일 결과를 버리고 null 을 돌려준다(기존 404 계약 유지)', async () => {
    const minuteQ = queryBuilder({ data: null, error: null })
    const filesQ = queryBuilder({ data: [FILE_ROW], error: null })
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => (table === 'minutes' ? minuteQ : filesQ)),
    })

    await expect(getMinuteDetail('min-1')).resolves.toBeNull()
    // 본문 부재로 반환된 null 은 파일 실패 로그도 남기지 않는다(종전과 동일).
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('파일 조회 실패는 로깅 후 빈 목록으로 진행한다(본문은 그대로 제공)', async () => {
    const minuteQ = queryBuilder({ data: MINUTE_ROW, error: null })
    const filesQ = queryBuilder({ data: null, error: { message: 'files down' } })
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => (table === 'minutes' ? minuteQ : filesQ)),
    })

    const result = await getMinuteDetail('min-1')
    expect(result?.minute.id).toBe('min-1')
    expect(result?.files).toEqual([])
    expect(consoleError).toHaveBeenCalledWith('[getMinuteDetail] 파일 목록 조회 실패:', 'files down')
  })
})

describe('getMinuteWikiImpact — job/변경 이력 병렬화', () => {
  const JOB_ROW = {
    status: 'done',
    payload: { summary: { created: 1, changed: 2, reaffirmed: 0, conflicted: 0 } },
    updated_at: '2026-08-10T00:00:00Z',
  }

  function stubEnv() {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  }

  it('job 응답을 기다리지 않고 변경 이력 쿼리를 함께 시작한다(직렬 3단 → 2단)', async () => {
    stubEnv()
    const job = deferred()
    const jobQ = queryBuilder(job.promise)
    const changesQ = queryBuilder({ data: [], error: null })
    const from = vi.fn((table: string) => (table === 'wiki_processing_jobs' ? jobQ : changesQ))
    mocks.createAdminClient.mockReturnValue({ from })

    const pending = getMinuteWikiImpact('min-1', 'p1', '프로젝트1')
    // job 결과가 아직 미해소인 시점에 변경 이력 조회가 이미 시작됐어야 한다.
    await vi.waitFor(() => expect(from).toHaveBeenCalledWith('wiki_change_events'))
    expect(from).toHaveBeenCalledWith('wiki_processing_jobs')

    job.resolve({ data: JOB_ROW, error: null })
    const result = await pending
    expect(result).toMatchObject({
      status: 'ready',
      counts: { created: 1, changed: 2, reaffirmed: 0, conflicted: 0 },
      items: [],
      processedAt: '2026-08-10T00:00:00Z',
    })
  })

  it('job 조회 실패면 변경 이력이 성공해도 fallback 을 돌려주고 wiki_items 는 조회하지 않는다', async () => {
    stubEnv()
    const jobQ = queryBuilder({ data: null, error: { message: 'job down' } })
    const changesQ = queryBuilder({
      data: [{ wiki_item_id: 'w1', change_type: 'new', created_at: '2026-08-10T00:00:00Z' }],
      error: null,
    })
    const from = vi.fn((table: string) => (table === 'wiki_processing_jobs' ? jobQ : changesQ))
    mocks.createAdminClient.mockReturnValue({ from })

    const result = await getMinuteWikiImpact('min-1', 'p1', '프로젝트1')
    expect(result).toEqual({
      status: 'queued',
      counts: { created: 0, changed: 0, reaffirmed: 0, conflicted: 0 },
      items: [],
      wikiHref: '/p/p1/wiki',
      projectName: '프로젝트1',
      processedAt: null,
    })
    expect(from).not.toHaveBeenCalledWith('wiki_items')
    expect(consoleError).toHaveBeenCalledWith('[getMinuteWikiImpact] 작업 조회 실패:', 'job down')
  })

  it('변경 이력 조회 실패면 job 파생 status/counts 만으로 응답한다(종전 계약 유지)', async () => {
    stubEnv()
    const jobQ = queryBuilder({ data: JOB_ROW, error: null })
    const changesQ = queryBuilder({ data: null, error: { message: 'changes down' } })
    const from = vi.fn((table: string) => (table === 'wiki_processing_jobs' ? jobQ : changesQ))
    mocks.createAdminClient.mockReturnValue({ from })

    const result = await getMinuteWikiImpact('min-1', 'p1', '프로젝트1')
    expect(result).toMatchObject({
      status: 'ready',
      counts: { created: 1, changed: 2, reaffirmed: 0, conflicted: 0 },
      items: [],
      processedAt: '2026-08-10T00:00:00Z',
    })
    expect(from).not.toHaveBeenCalledWith('wiki_items')
    expect(consoleError).toHaveBeenCalledWith('[getMinuteWikiImpact] 변경 이력 조회 실패:', 'changes down')
  })

  it('wiki_items 조회는 changes 결과(itemIds)에 의존해 뒤 단계로 남고, 항목 매핑을 유지한다', async () => {
    stubEnv()
    const jobQ = queryBuilder({ data: JOB_ROW, error: null })
    const changesQ = queryBuilder({
      data: [
        { wiki_item_id: 'w1', change_type: 'new', created_at: '2026-08-10T02:00:00Z' },
        { wiki_item_id: 'w2', change_type: 'update', created_at: '2026-08-10T01:00:00Z' },
        // 같은 항목의 더 오래된 이벤트 — 최신(new)이 이겨야 한다.
        { wiki_item_id: 'w1', change_type: 'reaffirm', created_at: '2026-08-10T00:00:00Z' },
      ],
      error: null,
    })
    const itemsQ = queryBuilder({
      data: [
        { id: 'w1', topic_id: 't1', kind: 'decision', statement: '결정 A', lifecycle_state: 'active' },
        { id: 'w2', topic_id: 't2', kind: 'fact', statement: '보관됨', lifecycle_state: 'archived' },
      ],
      error: null,
    })
    const from = vi.fn((table: string) => {
      if (table === 'wiki_processing_jobs') return jobQ
      if (table === 'wiki_change_events') return changesQ
      return itemsQ
    })
    mocks.createAdminClient.mockReturnValue({ from })

    const result = await getMinuteWikiImpact('min-1', 'p1', '프로젝트1')
    expect(itemsQ.in).toHaveBeenCalledWith('id', ['w1', 'w2'])
    expect(result.items).toEqual([{
      id: 'w1',
      title: '결정 A',
      href: '/p/p1/wiki/topics/t1#wiki-item-w1',
      kindLabel: 'decision',
      change: 'created',
    }])
  })
})
