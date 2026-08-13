import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseWikiRepository,
  wikiSearchTokens,
} from '@/lib/repositories/supabase/wiki'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'

type Result = {
  data: unknown
  error: { code?: string; message: string } | null
}

function query(result: Result) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: Result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'eq', 'in', 'or', 'ilike', 'is', 'not', 'order', 'limit', 'range',
  ]) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function clientWith(results: Record<string, Result[]>) {
  const queries: Record<string, ReturnType<typeof query>[]> = {}
  const client = {
    from: vi.fn((table: string) => {
      const result = results[table]?.shift() ?? { data: [], error: null }
      const built = query(result)
      ;(queries[table] ??= []).push(built)
      return built
    }),
  }
  return { client: client as unknown as SupabaseServerClient, queries }
}

const ITEM = {
  id: 'item-1',
  project_id: 'project-1',
  topic_id: 'topic-1',
  kind: 'fact',
  statement: 'ERP 오류 처리는 재처리 큐에서 수행한다.',
  lifecycle_state: 'active',
  certainty: 'explicit',
  decision_state: null,
  owner_team: 'ERP',
  due_date: null,
  observed_at: null,
  updated_at: '2026-08-13T00:00:00.000Z',
  review_state: 'accepted',
}

describe('Supabase Wiki 봇 읽기', () => {
  it('한국어 질문을 안전한 핵심어로 줄이고 accepted 지식과 활성 근거만 조회한다', async () => {
    expect(wikiSearchTokens('ERP 오류 처리는 어떻게 하나요?')).toEqual(['erp', '오류', '처리'])

    const { client, queries } = clientWith({
      wiki_items: [{ data: [ITEM], error: null }],
      wiki_topics: [
        { data: [], error: null },
        { data: [{ id: 'topic-1', title: 'ERP 운영' }], error: null },
      ],
      wiki_item_sources: [{
        data: [{ wiki_item_id: 'item-1', minute_id: 'minute-1', evidence_excerpt: '재처리 큐를 사용한다.' }],
        error: null,
      }],
    })

    const result = await createSupabaseWikiRepository(client).searchWikiKnowledge({
      projectId: 'project-1',
      query: 'ERP 오류 처리는 어떻게 하나요?',
      kind: null,
      limit: 5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.items[0]).toMatchObject({ id: 'item-1', topicTitle: 'ERP 운영' })
    expect(queries.wiki_items[0].eq).toHaveBeenCalledWith('review_state', 'accepted')
    expect(queries.wiki_items[0].or).toHaveBeenCalledWith(expect.stringContaining('statement.ilike'))
    expect(queries.wiki_item_sources[0].is).toHaveBeenCalledWith('retracted_at', null)
  })

  it('0079 review_state가 없을 때만 기존 항목을 accepted로 호환 조회한다', async () => {
    const { client, queries } = clientWith({
      wiki_items: [
        { data: null, error: { code: 'PGRST204', message: "column 'review_state' was not found" } },
        { data: [ITEM], error: null },
      ],
      wiki_topics: [{ data: [{ id: 'topic-1', title: 'ERP 운영' }], error: null }],
      wiki_item_sources: [{ data: [], error: null }],
    })

    const result = await createSupabaseWikiRepository(client).searchWikiKnowledge({
      projectId: 'project-1',
      query: null,
      kind: null,
      limit: 5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.items).toHaveLength(1)
    expect(queries.wiki_items).toHaveLength(2)
    expect(queries.wiki_items[0].select).toHaveBeenCalledWith(expect.stringContaining('review_state'))
    expect(queries.wiki_items[1].select).toHaveBeenCalledWith(expect.not.stringContaining('review_state'))
  })
})
