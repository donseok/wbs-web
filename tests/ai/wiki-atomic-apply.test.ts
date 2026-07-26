import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedWikiItem } from '@/lib/ai/wiki-ingest'
import type { MinuteBlock } from '@/lib/minutes/blocks'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: vi.fn(() => false) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesSync: vi.fn(() => ['ERP']) }))

import {
  applyExtractedItem,
  enqueueMinuteWikiProcessing,
} from '@/lib/ai/wiki-ingest'
import { wikiStatementHash } from '@/lib/domain/wiki'
import { fnv1a64 } from '@/lib/minutes/blocks'
import { createAdminClient } from '@/lib/supabase/admin'

type QueryResponse = {
  data?: unknown
  error?: { code?: string; message?: string; details?: string } | null
}

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: { data: unknown; error: QueryResponse['error'] }) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'insert', 'update', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) => Promise.resolve({
    data: response.data ?? null,
    error: response.error ?? null,
  }).then(resolve, reject)
  return builder
}

const evidence: MinuteBlock = {
  index: 0,
  hash: 'block-hash-0',
  text: 'ERP와 MES 연계는 REST API를 사용하기로 확정했다.',
  rendered: true,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(createAdminClient).mockReset()
})

function extractedItem(overrides: Partial<ExtractedWikiItem> = {}): ExtractedWikiItem {
  return {
    kind: 'decision',
    topic: '인터페이스 연계',
    topicType: 'interface',
    statement: 'REST API를 사용한다.',
    facet: '연계 방식',
    knowledgeKey: '인터페이스-연계:decision:연계-방식',
    certainty: 'explicit',
    decisionState: 'confirmed',
    relation: 'supports',
    semanticRelation: null,
    evidenceIndexes: [0],
    ownerTeam: 'ERP',
    ownerName: null,
    dueDate: null,
    effectiveDate: null,
    ...overrides,
  }
}

function applyArgs(item: ExtractedWikiItem) {
  return {
    projectId: '00000000-0000-4000-8000-000000000001',
    jobId: 91,
    jobLockedBy: 'worker-91',
    minuteId: '00000000-0000-4000-8000-000000000002',
    minuteVersionId: '00000000-0000-4000-8000-000000000003',
    minuteVersionNo: 2,
    applyGeneration: 0,
    observedAt: '2026-07-26T01:00:00.000Z',
    bodyHash: '0123456789abcdef',
    blocks: [evidence],
    item,
  }
}

describe('applyExtractedItem 원자 RPC', () => {
  it('항목·근거·이력을 직접 쓰지 않고 모든 근거를 단일 RPC payload로 전달한다', async () => {
    const item = extractedItem({
      // 해시는 앱 정규화 후 계산되므로 대문자/끝 마침표가 있는 statement 자체와 다르다.
      statement: 'REST API를 사용한다.',
    })
    const topicQuery = queryBuilder({ data: { id: '00000000-0000-4000-8000-000000000010', normalized_title: '인터페이스 연계' } })
    const currentQuery = queryBuilder({ data: null })
    const rpcQuery = queryBuilder({ data: { outcome: 'created' } })
    const from = vi.fn()
      .mockReturnValueOnce(topicQuery)
      .mockReturnValueOnce(currentQuery)
    const rpc = vi.fn<
      (name: string, payload: Record<string, unknown>) => typeof rpcQuery
    >(() => rpcQuery)
    const admin = { from, rpc }

    const outcome = await applyExtractedItem(admin as never, applyArgs(item))

    expect(outcome).toBe('created')
    expect(from.mock.calls.map(call => call[0])).toEqual(['wiki_topics', 'wiki_items'])
    expect(topicQuery.insert).not.toHaveBeenCalled()
    expect(topicQuery.update).not.toHaveBeenCalled()
    expect(currentQuery.insert).not.toHaveBeenCalled()
    expect(currentQuery.update).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('apply_wiki_extracted_item_atomic', expect.objectContaining({
      p_statement: 'REST API를 사용한다.',
      p_wiki_job_id: 91,
      p_job_locked_by: 'worker-91',
      p_apply_generation: 0,
      p_statement_hash: wikiStatementHash('REST API를 사용한다.'),
      p_expected_current_id: null,
      p_expected_current_hash: null,
      p_sources: [{
        block_index: 0,
        block_hash: 'block-hash-0',
        evidence_excerpt: evidence.text,
      }],
    }))
    const payload = rpc.mock.calls[0][1]
    expect(payload.p_statement_hash).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.parse(payload.p_idempotency_key as string)[3]).toBe(0)
  })

  it('잠금 안 current 재검증이 40001을 반환하면 current 읽기와 분류부터 다시 수행한다', async () => {
    const item = extractedItem({ semanticRelation: 'supersedes' })
    const topicQuery = queryBuilder({ data: { id: '00000000-0000-4000-8000-000000000010', normalized_title: '인터페이스 연계' } })
    const firstCurrent = queryBuilder({
      data: {
        id: '00000000-0000-4000-8000-000000000020',
        statement: 'FTP를 사용한다',
        statement_hash: '1111111111111111',
        knowledge_key: item.knowledgeKey,
        certainty: 'explicit',
        observed_at: '2026-07-25T01:00:00.000Z',
        valid_from: null,
        auto_update_locked: false,
        updated_at: '2026-07-25T01:00:00.000Z',
      },
    })
    const secondCurrent = queryBuilder({
      data: {
        id: '00000000-0000-4000-8000-000000000021',
        statement: 'SOAP을 사용한다',
        statement_hash: '2222222222222222',
        knowledge_key: item.knowledgeKey,
        certainty: 'explicit',
        observed_at: '2026-07-25T02:00:00.000Z',
        valid_from: null,
        auto_update_locked: false,
        updated_at: '2026-07-25T02:00:00.000Z',
      },
    })
    const rpcRace = queryBuilder({
      error: { code: '40001', message: 'WIKI_CURRENT_RACE' },
    })
    const rpcSuccess = queryBuilder({ data: { outcome: 'changed' } })
    const from = vi.fn()
      .mockReturnValueOnce(topicQuery)
      .mockReturnValueOnce(firstCurrent)
      .mockReturnValueOnce(secondCurrent)
    const rpc = vi.fn<
      (name: string, payload: Record<string, unknown>) => typeof rpcSuccess
    >(() => rpcSuccess)
      .mockReturnValueOnce(rpcRace)
      .mockReturnValueOnce(rpcSuccess)
    const admin = { from, rpc }

    const outcome = await applyExtractedItem(admin as never, applyArgs(item))

    expect(outcome).toBe('changed')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0][1]).toEqual(expect.objectContaining({
      p_expected_current_id: '00000000-0000-4000-8000-000000000020',
      p_expected_current_hash: '1111111111111111',
      p_expected_current_updated_at: '2026-07-25T01:00:00.000Z',
    }))
    expect(rpc.mock.calls[1][1]).toEqual(expect.objectContaining({
      p_expected_current_id: '00000000-0000-4000-8000-000000000021',
      p_expected_current_hash: '2222222222222222',
      p_expected_current_updated_at: '2026-07-25T02:00:00.000Z',
    }))
    expect(rpc.mock.calls[1][1].p_idempotency_key)
      .toBe(rpc.mock.calls[0][1].p_idempotency_key)
  })

  it('수동 current는 잠금 플래그가 없어도 앱 gate에서 자동 변경을 허용하지 않는다', async () => {
    const item = extractedItem({ semanticRelation: 'supersedes' })
    const topicQuery = queryBuilder({ data: { id: '00000000-0000-4000-8000-000000000010', normalized_title: '인터페이스 연계' } })
    const currentQuery = queryBuilder({
      data: {
        id: '00000000-0000-4000-8000-000000000020',
        statement: 'FTP를 사용한다',
        statement_hash: '1111111111111111',
        knowledge_key: item.knowledgeKey,
        certainty: 'explicit',
        observed_at: '2026-07-25T01:00:00.000Z',
        valid_from: null,
        origin: 'manual',
        auto_update_locked: false,
        updated_at: '2026-07-25T01:00:00.000Z',
      },
    })
    const rpcQuery = queryBuilder({ data: { outcome: 'conflicted' } })
    const rpc = vi.fn(() => rpcQuery)
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce(topicQuery)
        .mockReturnValueOnce(currentQuery),
      rpc,
    }

    await expect(applyExtractedItem(admin as never, applyArgs(item)))
      .resolves.toBe('conflicted')
    expect(rpc).toHaveBeenCalledWith(
      'apply_wiki_extracted_item_atomic',
      expect.objectContaining({ p_can_auto_apply: false }),
    )
  })

  it('job lease fencing 40001은 stale current 재시도로 오인하지 않고 즉시 중단한다', async () => {
    const item = extractedItem()
    const topicQuery = queryBuilder({ data: { id: '00000000-0000-4000-8000-000000000010', normalized_title: '인터페이스 연계' } })
    const currentQuery = queryBuilder({ data: null })
    const leaseLost = queryBuilder({
      error: { code: '40001', message: 'WIKI_JOB_LEASE_LOST' },
    })
    const rpc = vi.fn(() => leaseLost)
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce(topicQuery)
        .mockReturnValueOnce(currentQuery),
      rpc,
    }

    await expect(applyExtractedItem(admin as never, applyArgs(item)))
      .rejects.toThrow('WIKI_JOB_LEASE_LOST')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: 'pending', force: true, expectedGeneration: 5 },
    { status: 'running', force: true, expectedGeneration: 5 },
    { status: 'done', force: true, expectedGeneration: 5 },
    { status: 'dead_letter', force: true, expectedGeneration: 5 },
    { status: 'dead_letter', force: false, expectedGeneration: 4 },
  ] as const)(
    '$status job 재등록(force=$force)의 apply generation 계약을 지킨다',
    async ({ status, force, expectedGeneration }) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
      const bodyMd = '# 회의록\n\nREST API 사용을 확정했다.'
      const responses: Record<string, QueryResponse[]> = {
        minutes: [{
          data: {
            id: 'minute-1',
            title: '연계 회의',
            minute_date: '2026-07-26',
            meeting_occurrence_date: '2026-07-26',
            project_id: 'project-1',
            archived_at: null,
          },
        }],
        minute_versions: [{
          data: {
            id: 'version-1',
            version_no: 1,
            body_hash: fnv1a64(bodyMd),
            body_md: bodyMd,
            created_at: '2026-07-26T01:00:00.000Z',
          },
        }],
        wiki_processing_jobs: [
          {
            data: {
              id: 7,
              status,
              payload: { applyGeneration: 4, retained: true },
            },
          },
        ],
      }
      const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
      const admin = {
        from: vi.fn((table: string) => {
          const builder = queryBuilder((responses[table] ?? []).shift() ?? { data: null })
          ;(builders[table] ??= []).push(builder)
          return builder
        }),
        rpc: vi.fn(() => queryBuilder({
          data: {
            job_id: 7,
            status: status === 'running' ? 'running' : 'pending',
            apply_generation: expectedGeneration,
            rerun_requested: status === 'running',
          },
        })),
      }
      vi.mocked(createAdminClient).mockReturnValue(admin as never)

      const jobId = await enqueueMinuteWikiProcessing({
        projectId: 'project-1',
        minuteId: 'minute-1',
        minuteVersionId: 'version-1',
        bodyMd,
        force,
      })

      expect(jobId).toBe(7)
      expect(admin.rpc).toHaveBeenCalledWith(
        'request_wiki_processing_job_run',
        expect.objectContaining({
          p_job_id: 7,
          p_force: force,
          p_payload: expect.objectContaining({
            minute: expect.objectContaining({ projectId: 'project-1' }),
            version: expect.objectContaining({ id: 'version-1' }),
          }),
        }),
      )
      expect(builders.wiki_processing_jobs).toHaveLength(1)
    },
  )
})
