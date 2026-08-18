import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))

import { getWikiTopicDetail } from '@/lib/data/wiki'

type QueryResult = {
  data: unknown
  error: { message: string; code?: string } | null
}

function builder(result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: QueryResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'in', 'is', 'not', 'range']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

function filteringBuilder(rows: Record<string, unknown>[]) {
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
  query.then = (resolve, reject) => Promise.resolve({
    data: selected.slice(from, to + 1),
    error: null,
  }).then(resolve, reject)
  return query
}

describe('Wiki 주제 상세 조회', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('변경 시각 직전에 연결된 source의 minute_version_id를 타임라인에 보강한다', async () => {
    const queries: Record<string, ReturnType<typeof builder>[]> = {}
    const rows: Record<string, QueryResult> = {
      wiki_topics: {
        data: [{
          id: 'topic-1',
          project_id: 'project-version-test',
          title: 'ERP 연계',
          normalized_title: 'erp-연계',
          type: 'interface',
          owner_team: 'ERP',
          last_changed_at: '2026-07-25T10:00:00.000Z',
          created_at: '2026-07-25T09:00:00.000Z',
          updated_at: '2026-07-25T10:00:00.000Z',
        }],
        error: null,
      },
      wiki_items: {
        data: [{
          id: 'item-1',
          project_id: 'project-version-test',
          topic_id: 'topic-1',
          kind: 'decision',
          statement: 'REST API 연계가 확정되었다.',
          lifecycle_state: 'active',
          certainty: 'explicit',
          decision_state: 'confirmed',
          owner_team: 'ERP',
          owner_member_id: null,
          due_date: null,
          observed_at: '2026-07-25T00:00:00.000Z',
          valid_from: null,
          valid_to: null,
          origin: 'ai',
          auto_update_locked: false,
          structured_data: {},
          created_at: '2026-07-25T09:00:00.000Z',
          updated_at: '2026-07-25T10:00:00.000Z',
        }],
        error: null,
      },
      wiki_change_events: {
        data: [{
          id: 'change-1',
          project_id: 'project-version-test',
          wiki_item_id: 'item-1',
          minute_id: 'minute-1',
          change_type: 'new',
          before_snapshot: null,
          after_snapshot: { statement: 'REST API 연계가 확정되었다.' },
          reason: '회의록에서 명시적으로 확인했습니다.',
          created_at: '2026-07-25T10:00:00.000Z',
        }],
        error: null,
      },
      wiki_item_sources: {
        data: [
          {
            id: 'source-v1',
            wiki_item_id: 'item-1',
            minute_id: 'minute-1',
            minute_version_id: 'version-1',
            body_hash: 'body-1',
            block_index: 1,
            block_hash: 'block-1',
            evidence_excerpt: 'REST API 연계를 확정한다.',
            relation: 'supports',
            created_at: '2026-07-25T09:59:59.000Z',
          },
          {
            id: 'source-v2',
            wiki_item_id: 'item-1',
            minute_id: 'minute-1',
            minute_version_id: 'version-2',
            body_hash: 'body-2',
            block_index: 2,
            block_hash: 'block-2',
            evidence_excerpt: '후속 본문이다.',
            relation: 'supports',
            created_at: '2026-07-25T10:05:00.000Z',
          },
        ],
        error: null,
      },
      minutes: {
        data: [{
          id: 'minute-1',
          title: 'ERP 연계 회의',
          minute_date: '2026-07-25',
        }],
        error: null,
      },
    }
    const serverClient = {
      from: vi.fn((table: string) => {
        const query = builder(rows[table] ?? { data: [], error: null })
        ;(queries[table] ??= []).push(query)
        return query
      }),
    }
    mocks.createServerClient.mockResolvedValue(serverClient)

    const detail = await getWikiTopicDetail('project-version-test', 'topic-1')

    expect(detail.topic?.id).toBe('topic-1')
    expect(detail.items[0]?.id).toBe('item-1')
    expect(detail.changes).toHaveLength(1)
    expect(detail.changes[0].minuteVersionId).toBe('version-1')
    expect(queries.wiki_topics[0].eq).toHaveBeenCalledWith('id', 'topic-1')
    expect(queries.wiki_item_sources[0].select).toHaveBeenCalledWith(
      expect.stringContaining('created_at'),
    )
    // 사람이 닫거나 숨긴 항목은 '완료'·'숨김' 뷰에서 되돌릴 수 있어야 하므로 함께 읽고,
    // 집계와 나머지 목록에서만 제외한다.
    expect(queries.wiki_items[0].in).toHaveBeenCalledWith(
      'lifecycle_state',
      ['active', 'open', 'conflicted', 'archived', 'resolved'],
    )
    expect(queries.wiki_items[0].eq).toHaveBeenCalledWith('review_state', 'accepted')
    expect(queries.wiki_item_sources[0].is).toHaveBeenCalledWith('retracted_at', null)
    expect(queries.wiki_item_sources[1].not).toHaveBeenCalledWith('retracted_at', 'is', null)
  })

  it('기본 Wiki 테이블이 없으면 schema_missing을 일반 오류와 구분한다', async () => {
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn(() => builder({
        data: null,
        error: { code: 'PGRST205', message: "Could not find the table 'public.wiki_topics'" },
      })),
    })

    const detail = await getWikiTopicDetail('project-schema-missing', 'topic-1')

    expect(detail.available).toBe(false)
    expect(detail.readState).toBe('schema_missing')
  })

  it('권한·네트워크 같은 조회 실패를 schema_missing으로 위장하지 않는다', async () => {
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn(() => builder({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      })),
    })

    const detail = await getWikiTopicDetail('project-read-error', 'topic-1')

    expect(detail.available).toBe(false)
    expect(detail.readState).toBe('error')
  })

  it('0079 문서 컬럼이 없으면 기존 Wiki는 읽되 schema_missing을 명시한다', async () => {
    const results: Record<string, QueryResult[]> = {
      wiki_topics: [
        { data: null, error: { code: 'PGRST204', message: "column 'body_md' was not found" } },
        { data: [{
          id: 'legacy-topic', project_id: 'project-legacy', title: '기존 주제',
          normalized_title: '기존-주제', type: 'general', owner_team: null,
          last_changed_at: '2026-08-13T00:00:00.000Z',
          created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z',
        }], error: null },
      ],
      wiki_items: [
        { data: null, error: { code: 'PGRST204', message: "column 'review_state' was not found" } },
        { data: null, error: { code: 'PGRST204', message: "column 'review_state' was not found" } },
        { data: [], error: null },
      ],
      wiki_change_events: [{ data: [], error: null }],
    }
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => builder(
        results[table]?.shift() ?? { data: [], error: null },
      )),
    })

    const detail = await getWikiTopicDetail('project-legacy', 'legacy-topic')

    expect(detail.available).toBe(true)
    expect(detail.readState).toBe('schema_missing')
    expect(detail.topic).toMatchObject({ id: 'legacy-topic', bodyMd: null })
  })

  it('철회 근거는 현재 항목에서 빼고 당시 변경 provenance에만 사용한다', async () => {
    const tables: Record<string, Record<string, unknown>[]> = {
      wiki_topics: [{
        id: 'topic-source', project_id: 'project-source', title: '근거 정책',
        normalized_title: '근거-정책', type: 'policy', owner_team: null,
        body_md: null, body_updated_at: null, body_updated_by: null, parent_id: null,
        sort: 0, pinned_order: null, origin: 'ai', document_kind: null,
        verified_at: null, verified_by: null, review_due_at: null,
        last_changed_at: '2026-08-13T00:00:00.000Z',
        created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z',
      }],
      wiki_items: [{
        id: 'item-source', project_id: 'project-source', topic_id: 'topic-source',
        kind: 'fact', statement: '현재 정책', lifecycle_state: 'active', certainty: 'explicit',
        decision_state: null, owner_team: null, owner_member_id: null, due_date: null,
        observed_at: null, valid_from: null, valid_to: null, origin: 'ai',
        auto_update_locked: false, review_state: 'accepted', structured_data: {},
        created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z',
      }],
      wiki_item_sources: [
        {
          id: 'source-active', wiki_item_id: 'item-source', minute_id: 'minute-active',
          minute_version_id: 'version-active', relation: 'supports', retracted_at: null,
          created_at: '2026-08-13T00:00:00.000Z',
        },
        {
          id: 'source-retracted', wiki_item_id: 'item-source', minute_id: 'minute-old',
          minute_version_id: 'version-old', relation: 'contradicts',
          retracted_at: '2026-08-13T01:00:00.000Z',
          created_at: '2026-08-12T00:00:00.000Z',
        },
      ],
      wiki_change_events: [{
        id: 'change-old', project_id: 'project-source', wiki_item_id: 'item-source',
        minute_id: 'minute-old', source_id: 'source-retracted', change_type: 'change',
        before_snapshot: null, after_snapshot: null, created_at: '2026-08-12T00:05:00.000Z',
      }],
      minutes: [
        { id: 'minute-active', title: '현재 회의', minute_date: '2026-08-13' },
        { id: 'minute-old', title: '과거 회의', minute_date: '2026-08-12' },
      ],
      wiki_topic_revisions: [],
      wiki_questions: [],
      wiki_feedback: [],
    }
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => filteringBuilder(tables[table] ?? [])),
    })

    const detail = await getWikiTopicDetail('project-source', 'topic-source')

    expect(detail.items[0].sources.map((source) => source.id)).toEqual(['source-active'])
    expect(detail.items[0].sources[0].minuteTitle).toBe('현재 회의')
    expect(detail.changes[0].minuteVersionId).toBe('version-old')
    expect(detail.changes[0].minuteTitle).toBe('과거 회의')
  })

  it('500개를 넘는 항목도 range 페이지를 끝까지 읽어 집계한다', async () => {
    const itemRows = Array.from({ length: 501 }, (_, index) => ({
      id: `item-${index}`,
      project_id: 'project-paged',
      topic_id: 'topic-paged',
      kind: 'fact',
      statement: `지식 ${index}`,
      lifecycle_state: 'active',
      certainty: 'explicit',
      decision_state: null,
      owner_team: null,
      owner_member_id: null,
      due_date: null,
      observed_at: null,
      valid_from: null,
      valid_to: null,
      origin: 'ai',
      auto_update_locked: false,
      review_state: 'accepted',
      structured_data: {},
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
    }))
    const tables: Record<string, Record<string, unknown>[]> = {
      wiki_topics: [{
        id: 'topic-paged', project_id: 'project-paged', title: '전체 지식',
        normalized_title: '전체-지식', type: 'general', owner_team: null,
        body_md: null, body_updated_at: null, body_updated_by: null, parent_id: null,
        sort: 0, pinned_order: null, origin: 'ai', document_kind: null,
        verified_at: null, verified_by: null, review_due_at: null,
        last_changed_at: '2026-08-13T00:00:00.000Z',
        created_at: '2026-08-13T00:00:00.000Z', updated_at: '2026-08-13T00:00:00.000Z',
      }],
      wiki_items: itemRows,
      wiki_change_events: [],
      wiki_item_sources: [],
      wiki_topic_revisions: [],
      wiki_questions: [],
      wiki_feedback: [],
      minutes: [],
    }
    const itemQueries: ReturnType<typeof filteringBuilder>[] = []
    mocks.createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        const query = filteringBuilder(tables[table] ?? [])
        if (table === 'wiki_items') itemQueries.push(query)
        return query
      }),
    })

    const detail = await getWikiTopicDetail('project-paged', 'topic-paged')

    expect(detail.items).toHaveLength(501)
    expect(detail.topic?.itemCount).toBe(501)
    expect(detail.dataTruncated).toBe(false)
    expect(itemQueries.some((query) => query.range.mock.calls.some(
      ([from, to]) => from === 500 && to === 999,
    ))).toBe(true)
  })
})
