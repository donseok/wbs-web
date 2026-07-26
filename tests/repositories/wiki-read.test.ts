import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}))

import { getWikiOverview } from '@/lib/data/wiki'

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
  for (const method of ['select', 'eq', 'order', 'limit', 'in']) {
    query[method] = vi.fn(() => query)
  }
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

describe('Wiki 변경 이력 원문 버전 조회', () => {
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

    const overview = await getWikiOverview('project-version-test')

    expect(overview.changes).toHaveLength(1)
    expect(overview.changes[0].minuteVersionId).toBe('version-1')
    expect(queries.wiki_item_sources[0].select).toHaveBeenCalledWith(
      expect.stringContaining('created_at'),
    )
    // archived는 '숨김' 뷰에서 되돌릴 수 있어야 하므로 함께 읽고, 집계와 목록에서만 제외한다.
    expect(queries.wiki_items[0].in).toHaveBeenCalledWith(
      'lifecycle_state',
      ['active', 'open', 'conflicted', 'archived'],
    )
  })
})
