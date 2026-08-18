import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))

import { getWikiOverview, getWikiTopicDetail } from '@/lib/data/wiki'

type Row = Record<string, unknown>
type QueryResult = {
  data: unknown
  error: { message: string; code?: string } | null
}

/**
 * 2026-08-18 성능 감사 회귀 방지 — getWikiOverview/getWikiTopicDetail 이 독립 조회를
 * 직렬 대기하지 않고 단계별 Promise.all 로 동시에 발사하는지 고정한다.
 *
 * 검증 방법: 쿼리를 수동 해제(release) 전까지 결과를 내주지 않는 빌더로 바꿔 두고,
 * "아직 아무 결과도 도착하지 않은 시점"에 어떤 테이블 조회가 이미 발사됐는지 본다.
 * 직렬 구현이라면 첫 조회(wiki_topics)만 발사돼 있어야 하고, 병렬 구현이라면
 * 같은 단계의 독립 조회가 전부 발사돼 있다.
 */

/** filteringBuilder 와 같은 필터 시맨틱이되, release 를 불러줄 때까지 결과를 내주지 않는다. */
function deferredFilteringBuilder(rows: Row[], releases: Array<() => void>) {
  let selected = [...rows]
  let from = 0
  let to = Number.MAX_SAFE_INTEGER
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: QueryResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      selected = selected.filter((row) => row[column] === value)
      return query
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      selected = selected.filter((row) => values.includes(row[column]))
      return query
    }),
    is: vi.fn((column: string, value: unknown) => {
      selected = selected.filter((row) => row[column] === value || (value === null && row[column] == null))
      return query
    }),
    not: vi.fn((column: string, operator: string, value: unknown) => {
      if (operator === 'is' && value === null) selected = selected.filter((row) => row[column] != null)
      return query
    }),
    range: vi.fn((nextFrom: number, nextTo: number) => {
      from = nextFrom
      to = nextTo
      return query
    }),
  }
  query.then = (resolve, reject) => new Promise<QueryResult>((settle) => {
    releases.push(() => settle({ data: selected.slice(from, to + 1), error: null }))
  }).then(resolve, reject)
  return query
}

async function drainMicrotasks() {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

/** 보류 중인 조회를 라운드 단위로 해제하며 결과 promise 가 정착할 때까지 진행한다. */
async function flushUntilSettled<T>(promise: Promise<T>, releases: Array<() => void>): Promise<T> {
  let settled = false
  const tracked = promise.then(
    (value) => { settled = true; return value },
    (reason) => { settled = true; throw reason },
  )
  for (let round = 0; round < 50 && !settled; round += 1) {
    for (const release of releases.splice(0)) release()
    await drainMicrotasks()
  }
  return tracked
}

function makeClient(tables: Record<string, Row[]>, releases: Array<() => void>, issued: string[]) {
  return {
    from: vi.fn((table: string) => {
      issued.push(table)
      return deferredFilteringBuilder(tables[table] ?? [], releases)
    }),
  }
}

function topicRow(projectId: string, id: string): Row {
  return {
    id, project_id: projectId, title: '병렬 주제', normalized_title: '병렬-주제',
    type: 'general', owner_team: null,
    body_md: null, body_updated_at: null, body_updated_by: null, parent_id: null,
    sort: 0, pinned_order: null, origin: 'ai', document_kind: null,
    verified_at: null, verified_by: null, review_due_at: null,
    last_changed_at: '2026-08-18T00:00:00.000Z',
    created_at: '2026-08-18T00:00:00.000Z', updated_at: '2026-08-18T00:00:00.000Z',
  }
}

function itemRow(projectId: string, topicId: string, index: number): Row {
  return {
    id: `item-${index}`, project_id: projectId, topic_id: topicId,
    kind: 'fact', statement: `지식 ${index}`, lifecycle_state: 'active', certainty: 'explicit',
    decision_state: null, owner_team: null, owner_member_id: null, due_date: null,
    observed_at: null, valid_from: null, valid_to: null, origin: 'ai',
    auto_update_locked: false, review_state: 'accepted', structured_data: {},
    created_at: '2026-08-18T00:00:00.000Z', updated_at: '2026-08-18T00:00:00.000Z',
  }
}

describe('Wiki 읽기 경로 병렬화 회귀', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getWikiOverview 1단(주제·항목·변경)은 동시에 발사되고 2단(근거·질문/피드백)은 1단 뒤에 발사된다', async () => {
    const releases: Array<() => void> = []
    const issued: string[] = []
    const projectId = 'project-parallel-overview'
    mocks.createServerClient.mockResolvedValue(makeClient({
      wiki_topics: [topicRow(projectId, 'topic-parallel')],
      wiki_items: [itemRow(projectId, 'topic-parallel', 0)],
      wiki_item_sources: [],
      wiki_change_events: [],
      wiki_questions: [],
      wiki_feedback: [],
      minutes: [],
    }, releases, issued))

    const promise = getWikiOverview(projectId)
    await drainMicrotasks()

    // 아직 아무 결과도 해제하지 않았다 — 1단 독립 조회 셋이 전부 나가 있어야 병렬이다.
    expect(issued).toContain('wiki_topics')
    expect(issued).toContain('wiki_items')
    expect(issued).toContain('wiki_change_events')
    // 항목 승인분/제안분도 직렬 2왕복이 아니라 동시 발사된다.
    expect(issued.filter((table) => table === 'wiki_items')).toHaveLength(2)
    // 의존 조회(근거)와 확장 스키마 확인 뒤의 질문/피드백은 아직 나가면 안 된다.
    expect(issued).not.toContain('wiki_item_sources')
    expect(issued).not.toContain('wiki_questions')
    expect(issued).not.toContain('wiki_feedback')

    // 1단 해제 → 2단(근거 + 질문/피드백)이 함께 발사된다.
    for (const release of releases.splice(0)) release()
    await drainMicrotasks()
    expect(issued).toContain('wiki_item_sources')
    expect(issued).toContain('wiki_questions')
    expect(issued).toContain('wiki_feedback')

    const overview = await flushUntilSettled(promise, releases)
    expect(overview.available).toBe(true)
    expect(overview.readState).toBe('ready')
    expect(overview.items).toHaveLength(1)
    expect(overview.summary.topicCount).toBe(1)
  })

  it('getWikiTopicDetail 1단(주제·항목·큐레이션)은 동시에 발사된다', async () => {
    const releases: Array<() => void> = []
    const issued: string[] = []
    const projectId = 'project-parallel-detail'
    mocks.createServerClient.mockResolvedValue(makeClient({
      wiki_topics: [topicRow(projectId, 'topic-detail')],
      wiki_items: [],
      wiki_item_sources: [],
      wiki_change_events: [],
      wiki_topic_revisions: [],
      wiki_questions: [],
      wiki_feedback: [],
      minutes: [],
    }, releases, issued))

    const promise = getWikiTopicDetail(projectId, 'topic-detail')
    await drainMicrotasks()

    expect(issued).toContain('wiki_topics')
    expect(issued.filter((table) => table === 'wiki_items')).toHaveLength(2)
    // 큐레이션 이벤트는 topic/items 와 독립이므로 1단에 함께 나간다.
    expect(issued).toContain('wiki_change_events')
    expect(issued).not.toContain('wiki_topic_revisions')

    // 1단 해제 → 부가 테이블 셋이 한 단계로 발사된다.
    for (const release of releases.splice(0)) release()
    await drainMicrotasks()
    expect(issued).toContain('wiki_topic_revisions')
    expect(issued).toContain('wiki_questions')
    expect(issued).toContain('wiki_feedback')

    const detail = await flushUntilSettled(promise, releases)
    expect(detail.available).toBe(true)
    expect(detail.topic?.id).toBe('topic-detail')
    expect(detail.readState).toBe('ready')
  })

  it('항목 100개 초과 시 근거·변경 청크 조회가 순차 루프가 아니라 동시에 발사되고 집계가 보존된다', async () => {
    const releases: Array<() => void> = []
    const issued: string[] = []
    const projectId = 'project-parallel-chunks'
    const items = Array.from({ length: 150 }, (_, index) => itemRow(projectId, 'topic-chunks', index))
    const sources = items.map((item, index) => ({
      id: `source-${index}`, wiki_item_id: item.id, minute_id: 'minute-1',
      minute_version_id: `version-${index}`, body_hash: null, block_index: null, block_hash: null,
      evidence_excerpt: null, relation: 'supports', retracted_at: null,
      created_at: '2026-08-18T00:00:00.000Z',
    }))
    mocks.createServerClient.mockResolvedValue(makeClient({
      wiki_topics: [topicRow(projectId, 'topic-chunks')],
      wiki_items: items,
      wiki_item_sources: sources,
      wiki_change_events: [],
      wiki_topic_revisions: [],
      wiki_questions: [],
      wiki_feedback: [],
      minutes: [{ id: 'minute-1', title: '근거 회의', minute_date: '2026-08-18' }],
    }, releases, issued))

    const promise = getWikiTopicDetail(projectId, 'topic-chunks')
    await drainMicrotasks()
    for (const release of releases.splice(0)) release()
    await drainMicrotasks()

    // 150개 항목 = 2청크. 근거는 청크당 (현행+철회) 2건씩 4건, 변경 이력은 청크당 1건씩 2건이
    // 아직 아무 2단 결과도 해제되지 않은 시점에 전부 나가 있어야 한다(청크 병렬).
    expect(issued.filter((table) => table === 'wiki_item_sources')).toHaveLength(4)
    // 1단의 큐레이션 1건 + 2단의 청크 2건.
    expect(issued.filter((table) => table === 'wiki_change_events')).toHaveLength(3)

    const detail = await flushUntilSettled(promise, releases)
    expect(detail.available).toBe(true)
    expect(detail.items).toHaveLength(150)
    // 청크 병렬화가 근거 연결을 잃지 않는다 — 항목마다 자기 근거 1건씩.
    expect(detail.items.every((item) => item.sources.length === 1)).toBe(true)
    expect(detail.items[0].sources[0].minuteTitle).toBe('근거 회의')
    expect(detail.dataTruncated).toBe(false)
  })
})
