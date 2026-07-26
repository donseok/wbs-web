import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MinuteBlock } from '@/lib/minutes/blocks'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  generateAnswer: vi.fn(),
  hasLLM: vi.fn(() => false),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: mocks.generateAnswer }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: mocks.hasLLM }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/teams/master', () => ({
  activeTeamCodesSync: vi.fn(() => ['PMO', 'ERP', 'MES', '가공', 'MDM']),
}))

import {
  parseExtractedWikiItems,
  processMinuteWikiJob,
  processWikiProjectRebuildStep,
  runWikiWorkerOnce,
} from '@/lib/ai/wiki-ingest'
import { fnv1a64 } from '@/lib/minutes/blocks'

const blocks: MinuteBlock[] = [
  {
    index: 0,
    hash: 'h0',
    text: '연계 방식',
    rendered: true,
    headingDepth: 2,
  },
  {
    index: 1,
    hash: 'h1',
    text: 'ERP와 MES 연계는 REST API를 사용하기로 확정했다.',
    rendered: true,
  },
  {
    index: 2,
    hash: 'h2',
    text: '배치 방식도 검토할 예정이다.',
    rendered: true,
  },
  {
    index: 3,
    hash: 'h3',
    text: 'PMO가 2026-08-15까지 전환 작업을 완료하기로 합의했다.',
    rendered: true,
  },
  {
    index: 4,
    hash: 'h4',
    text: '',
    rendered: false,
  },
  {
    index: 5,
    hash: 'h5',
    text: '기존 FTP 연계는 취소하고 REST API로 변경한다.',
    rendered: true,
  },
  {
    index: 6,
    hash: 'h6',
    text: 'ERP와 MES 연계 방식은 REST API다.',
    rendered: true,
  },
  {
    index: 7,
    hash: 'h7',
    text: 'PMO가 전환 작업을 담당한다.',
    rendered: true,
  },
]

afterEach(() => {
  vi.unstubAllEnvs()
  mocks.hasLLM.mockReturnValue(false)
  mocks.generateAnswer.mockReset()
  mocks.createAdminClient.mockReset()
})

function item(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'decision',
    topic: '인터페이스 / 연계',
    topicType: 'interface',
    statement: 'ERP와 MES 연계는 REST API를 사용하기로 확정했다.',
    knowledgeKey: 'ERP / MES 연계 방식',
    certainty: 'explicit',
    decisionState: 'confirmed',
    relation: 'supports',
    semanticRelation: null,
    evidence: [1],
    ownerTeam: 'ERP',
    ownerName: null,
    dueDate: null,
    effectiveDate: null,
    ...overrides,
  }
}

describe('parseExtractedWikiItems', () => {
  it('코드펜스와 설명이 붙은 JSON을 읽고 명시적 확정 결정으로 정규화한다', () => {
    const raw = [
      '분석 결과입니다.',
      '```json',
      JSON.stringify({ items: [item({ evidence: [1, 1, 99] })] }),
      '```',
    ].join('\n')

    const result = parseExtractedWikiItems(raw, blocks)

    expect(result).toHaveLength(1)
    expect(result![0]).toMatchObject({
      kind: 'decision',
      topicType: 'interface',
      statement: 'ERP와 MES 연계는 REST API를 사용하기로 확정했다.',
      knowledgeKey: '인터페이스-연계:decision:erp-mes-연계-방식',
      certainty: 'explicit',
      decisionState: 'confirmed',
      relation: 'supports',
      evidenceIndexes: [1],
      ownerTeam: 'ERP',
    })
  })

  it('직접 근거가 없거나 범위 밖·비렌더 블록만 가리키는 항목은 버린다', () => {
    const raw = JSON.stringify({
      items: [
        item({ evidence: [] }),
        item({ statement: '존재하지 않는 근거', evidence: [99] }),
        item({ statement: '렌더되지 않는 근거', evidence: [4] }),
      ],
    })

    expect(parseExtractedWikiItems(raw, blocks)).toEqual([])
  })

  it('LLM이 explicit/confirmed라 해도 원문이 검토·예정 표현이면 tentative로 낮춘다', () => {
    const raw = JSON.stringify({
      items: [item({
        statement: '배치 방식도 적용하기로 확정했다.',
        evidence: [2],
        relation: 'contradicts',
        semanticRelation: 'supersedes',
      })],
    })

    expect(parseExtractedWikiItems(raw, blocks)).toEqual([
      expect.objectContaining({
        certainty: 'tentative',
        decisionState: 'tentative',
        // 원문에 반박/취소 표현이 없으므로 관계 역시 안전한 supports로 내린다.
        relation: 'supports',
        // 기존 항목을 보지 못한 LLM의 관계 추측도 "대신/변경" 표지가 없으면 버린다.
        semanticRelation: null,
      }),
    ])
  })

  it('supersedes는 원문에 대신/변경 표지가 있을 때만 통과시킨다', () => {
    const raw = JSON.stringify({
      items: [
        item({
          statement: 'ERP와 MES 연계 방식은 REST API다.',
          semanticRelation: 'supersedes',
          evidence: [6],
        }),
        item({
          statement: '기존 FTP 대신 REST API로 변경한다.',
          semanticRelation: 'supersedes',
          evidence: [5],
        }),
      ],
    })

    const result = parseExtractedWikiItems(raw, blocks)!

    expect(result).toHaveLength(2)
    expect(result[0].semanticRelation).toBeNull()
    expect(result[1].semanticRelation).toBe('supersedes')
  })

  it('결정은 LLM이 explicit이라 해도 원문에 확정·합의 표지가 없으면 잠정으로 낮춘다', () => {
    const raw = JSON.stringify({
      items: [item({
        statement: 'ERP와 MES 연계 방식은 REST API다.',
        certainty: 'explicit',
        decisionState: 'confirmed',
        evidence: [6],
      })],
    })

    expect(parseExtractedWikiItems(raw, blocks)).toEqual([
      expect.objectContaining({
        certainty: 'tentative',
        decisionState: 'tentative',
      }),
    ])
  })

  it('resolves 관계는 완료·해결 표지가 있는 원문에서만 통과시킨다', () => {
    const raw = JSON.stringify({
      items: [
        item({
          kind: 'action',
          statement: 'PMO가 전환 작업을 담당한다.',
          relation: 'resolves',
          semanticRelation: 'resolves',
          evidence: [7],
        }),
        item({
          kind: 'action',
          statement: 'PMO의 전환 작업이 완료되었다.',
          relation: 'resolves',
          semanticRelation: 'resolves',
          evidence: [3],
        }),
      ],
    })

    const result = parseExtractedWikiItems(raw, blocks)!

    expect(result[0]).toMatchObject({ relation: 'supports', semanticRelation: null })
    expect(result[1]).toMatchObject({ relation: 'resolves', semanticRelation: 'resolves' })
  })

  it('잘못된 열거값·날짜·팀은 안전한 기본값 또는 null로 제한한다', () => {
    const raw = JSON.stringify({
      items: [
        item({ kind: 'opinion', statement: '허용되지 않은 kind' }),
        item({
          kind: 'fact',
          topicType: 'unknown-type',
          statement: 'ERP 전환 상태는 확정되었다.',
          decisionState: 'invalid-state',
          relation: 'invalid-relation',
          semanticRelation: 'similar',
          ownerTeam: 'QA',
          ownerName: '  김 담당  ',
          dueDate: '2026/08/15',
          effectiveDate: '15-08-2026',
          evidence: [3],
        }),
      ],
    })

    const result = parseExtractedWikiItems(raw, blocks)

    expect(result).toHaveLength(1)
    expect(result![0]).toMatchObject({
      kind: 'fact',
      topicType: 'general',
      certainty: 'explicit',
      decisionState: null,
      relation: 'supports',
      semanticRelation: null,
      ownerTeam: null,
      ownerName: '김 담당',
      dueDate: null,
      effectiveDate: null,
    })
  })

  it('표기 변형에도 동일한 안정 knowledge key를 만들고 명시적 날짜·팀은 보존한다', () => {
    const raw = JSON.stringify({
      items: [
        item({
          statement: 'ERP와 MES 연계는 REST API를 사용하기로 확정했다.',
          knowledgeKey: ' ERP / MES 연계 방식 ',
          evidence: [1],
        }),
        item({
          statement: 'REST API 명세도 확정했다.',
          knowledgeKey: 'erp-mes---연계 방식',
          evidence: [1],
          dueDate: '2026-08-15',
          effectiveDate: '2026-09-01',
        }),
      ],
    })

    const result = parseExtractedWikiItems(raw, blocks)!

    expect(result).toHaveLength(2)
    expect(result[0].knowledgeKey).toBe(result[1].knowledgeKey)
    expect(result[1]).toMatchObject({
      certainty: 'explicit',
      decisionState: 'confirmed',
      ownerTeam: 'ERP',
      dueDate: '2026-08-15',
      effectiveDate: '2026-09-01',
    })
  })

  it('근거 문구가 뒷받침하는 철회와 의미 관계를 그대로 통과시킨다', () => {
    const raw = JSON.stringify({
      items: [item({
        statement: '기존 FTP 연계 결정을 철회하고 REST API로 변경한다.',
        decisionState: 'reversed',
        relation: 'contradicts',
        semanticRelation: 'reverses',
        evidence: [5],
      })],
    })

    expect(parseExtractedWikiItems(raw, blocks)).toEqual([
      expect.objectContaining({
        certainty: 'explicit',
        decisionState: 'reversed',
        relation: 'contradicts',
        semanticRelation: 'reverses',
        evidenceIndexes: [5],
      }),
    ])
  })
})

type QueryResponse = {
  data?: unknown
  error?: { message?: string; code?: string } | null
}

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (
      resolve: (value: { data: unknown; error: QueryResponse['error'] }) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'insert', 'update', 'eq', 'in', 'lt', 'lte', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) => Promise.resolve({
    data: response.data ?? null,
    error: response.error ?? null,
  }).then(resolve, reject)
  return builder
}

describe('processMinuteWikiJob 버전 안전성', () => {
  it('더 최신 회의록 버전이 있으면 과거 job을 정상 완료하되 지식 추출은 건너뛴다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const bodyMd = '# v1 회의록\n\nREST API 연계를 확정했다.'
    const bodyHash = fnv1a64(bodyMd)
    const claimedJob = {
      id: 41,
      project_id: 'project-1',
      minute_id: 'minute-1',
      minute_version_id: 'version-1',
      body_hash: bodyHash,
      status: 'running',
      attempts: 1,
      max_attempts: 5,
      locked_by: 'worker-41',
      payload: {},
    }
    const tables: Record<string, QueryResponse[]> = {
      minutes: [{
        data: {
          id: 'minute-1',
          title: 'ERP 연계 회의',
          minute_date: '2026-07-25',
          meeting_occurrence_date: '2026-07-25',
          project_id: 'project-1',
          archived_at: null,
        },
      }],
      minute_versions: [
        {
          data: {
            id: 'version-1',
            version_no: 1,
            body_md: bodyMd,
            body_hash: bodyHash,
            created_at: '2026-07-25T01:00:00.000Z',
          },
        },
        { data: { version_no: 2, body_hash: fnv1a64('# v2 다른 본문') } },
      ],
    }
    const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
    const admin = {
      from: vi.fn((table: string) => {
        const builder = queryBuilder((tables[table] ?? []).shift() ?? { data: null })
        ;(builders[table] ??= []).push(builder)
        return builder
      }),
      rpc: vi.fn((name: string) => queryBuilder(
        name === 'claim_wiki_processing_job'
          ? { data: claimedJob }
          : {
              data: {
                job_id: 41,
                status: 'done',
                apply_generation: 0,
                rerun_requested: false,
              },
            },
      )),
    }
    mocks.createAdminClient.mockReturnValue(admin)

    const summary = await processMinuteWikiJob(41)

    expect(summary).toEqual({ created: 0, changed: 0, reaffirmed: 0, conflicted: 0 })
    expect(mocks.generateAnswer).not.toHaveBeenCalled()
    expect(admin.from).not.toHaveBeenCalledWith('wiki_processing_jobs')
    expect(admin.rpc).toHaveBeenNthCalledWith(
      1,
      'claim_wiki_processing_job',
      expect.objectContaining({ p_job_id: 41 }),
    )
    expect(admin.rpc).toHaveBeenCalledWith(
      'finish_wiki_processing_job',
      expect.objectContaining({
        p_job_id: 41,
        p_succeeded: true,
        p_payload: expect.objectContaining({
          skipped: 'SUPERSEDED_MINUTE_VERSION',
          summary: { created: 0, changed: 0, reaffirmed: 0, conflicted: 0 },
        }),
      }),
    )
  })

  it('더 최신 version의 body hash가 같으면 file-only append로 보고 기존 근거 처리를 계속한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    mocks.hasLLM.mockReturnValue(true)
    mocks.generateAnswer.mockResolvedValue('{"items":[]}')
    const bodyMd = '# v1 회의록\n\nREST API 연계를 확정했다.'
    const bodyHash = fnv1a64(bodyMd)
    const claimedJob = {
      id: 43,
      project_id: 'project-1',
      minute_id: 'minute-1',
      minute_version_id: 'version-1',
      body_hash: bodyHash,
      status: 'running',
      attempts: 1,
      max_attempts: 5,
      locked_by: 'worker-43',
      payload: {},
    }
    const tables: Record<string, QueryResponse[]> = {
      minutes: [
        {
          data: {
            id: 'minute-1',
            title: 'ERP 연계 회의',
            minute_date: '2026-07-25',
            meeting_occurrence_date: '2026-07-25',
            project_id: 'project-1',
            archived_at: null,
            created_at: '2026-07-25T01:00:00.000Z',
          },
        },
        { data: { project_id: 'project-1', archived_at: null } },
      ],
      minute_versions: [
        {
          data: {
            id: 'version-1',
            version_no: 1,
            body_md: bodyMd,
            body_hash: bodyHash,
            created_at: '2026-07-25T01:00:00.000Z',
          },
        },
        { data: { version_no: 2, body_hash: bodyHash } },
      ],
    }
    const admin = {
      from: vi.fn((table: string) =>
        queryBuilder((tables[table] ?? []).shift() ?? { data: null })),
      rpc: vi.fn((name: string) => queryBuilder(
        name === 'claim_wiki_processing_job'
          ? { data: claimedJob }
          : {
              data: {
                job_id: 43,
                status: 'done',
                apply_generation: 0,
                rerun_requested: false,
              },
            },
      )),
    }
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(processMinuteWikiJob(43)).resolves.toEqual({
      created: 0,
      changed: 0,
      reaffirmed: 0,
      conflicted: 0,
    })
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith(
      'finish_wiki_processing_job',
      expect.objectContaining({
        p_job_id: 43,
        p_succeeded: true,
        p_payload: { summary: { created: 0, changed: 0, reaffirmed: 0, conflicted: 0 } },
      }),
    )
  })

  it('LLM 처리 중 최신 버전이 생겨 RPC가 거부하면 과거 job을 실패 재시도하지 않고 skip 완료한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    mocks.hasLLM.mockReturnValue(true)
    const bodyMd = '# 연계 방식\n\nERP와 MES 연계는 REST API를 사용하기로 확정했다.'
    const bodyHash = fnv1a64(bodyMd)
    const claimedJob = {
      id: 42,
      project_id: 'project-1',
      minute_id: 'minute-1',
      minute_version_id: 'version-1',
      body_hash: bodyHash,
      status: 'running',
      attempts: 1,
      max_attempts: 5,
      locked_by: 'worker-42',
      payload: { applyGeneration: 3 },
    }
    mocks.generateAnswer.mockResolvedValue(JSON.stringify({
      items: [item({ evidence: [1] })],
    }))
    const tables: Record<string, QueryResponse[]> = {
      minutes: [
        {
          data: {
            id: 'minute-1',
            title: 'ERP 연계 회의',
            minute_date: '2026-07-25',
            meeting_occurrence_date: '2026-07-25',
            project_id: 'project-1',
            archived_at: null,
          },
        },
        { data: { project_id: 'project-1', archived_at: null } },
      ],
      minute_versions: [
        {
          data: {
            id: 'version-1',
            version_no: 1,
            body_md: bodyMd,
            body_hash: bodyHash,
            created_at: '2026-07-25T01:00:00.000Z',
          },
        },
        { data: { version_no: 1, body_hash: bodyHash } },
      ],
      // 추출 전 기존 지식 카탈로그 조회 → 주제 확정 순서로 소비된다.
      wiki_topics: [
        { data: [] },
        { data: { id: 'topic-1', normalized_title: 'erp 연계' } },
      ],
      wiki_items: [{ data: [] }, { data: null }],
    }
    const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
    const rpc = vi.fn((name: string) => {
      if (name === 'claim_wiki_processing_job') {
        return queryBuilder({ data: claimedJob })
      }
      if (name === 'apply_wiki_extracted_item_atomic') {
        return queryBuilder({
          error: { code: '55000', message: 'WIKI_STALE_MINUTE_VERSION' },
        })
      }
      return queryBuilder({
        data: {
          job_id: 42,
          status: 'done',
          apply_generation: 3,
          rerun_requested: false,
        },
      })
    })
    const admin = {
      from: vi.fn((table: string) => {
        const builder = queryBuilder((tables[table] ?? []).shift() ?? { data: null })
        ;(builders[table] ??= []).push(builder)
        return builder
      }),
      rpc,
    }
    mocks.createAdminClient.mockReturnValue(admin)

    const summary = await processMinuteWikiJob(42)

    expect(summary).toEqual({ created: 0, changed: 0, reaffirmed: 0, conflicted: 0 })
    expect(admin.rpc).toHaveBeenCalledTimes(3)
    expect(admin.rpc).toHaveBeenNthCalledWith(
      3,
      'finish_wiki_processing_job',
      expect.objectContaining({
        p_job_id: 42,
        p_succeeded: true,
        p_payload: expect.objectContaining({
          skipped: 'SUPERSEDED_MINUTE_VERSION',
        }),
      }),
    )
  })
})

describe('runWikiWorkerOnce lease와 force 경합', () => {
  it('DB 시각으로 새 minute job을 선점해 한 호출에서 project step을 limit까지 이어간다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    mocks.hasLLM.mockReturnValue(true)
    mocks.generateAnswer.mockResolvedValue('{"items":[]}')

    const workerAdmin = {
      from: vi.fn(() => queryBuilder({ data: [] })),
      rpc: vi.fn(),
    }
    const projectAdmins = [1, 2].map((index) => ({
      rpc: vi.fn((name: string) => queryBuilder(
        name === 'claim_wiki_project_rebuild_step'
          ? {
              data: {
                claimed_project_id: 'project-1',
                rebuild_generation: 1,
                minute_id: `minute-${index}`,
                minute_version_id: `version-${index}`,
                wiki_job_id: 100 + index,
                wiki_apply_generation: 0,
                finished: false,
              },
            }
          : {
              data: {
                rebuilt_project_id: 'project-1',
                rebuild_status: 'pending',
                rebuild_generation: 1,
                cursor_advanced: true,
              },
            },
      )),
    }))
    const minuteAdmins = [1, 2].map((index) => {
      const bodyMd = `# 회의록 ${index}\n\nREST API 적용을 확정했다.`
      const bodyHash = fnv1a64(bodyMd)
      const tables: Record<string, QueryResponse[]> = {
        minutes: [
          {
            data: {
              id: `minute-${index}`,
              title: `회의록 ${index}`,
              minute_date: '2026-07-26',
              meeting_occurrence_date: '2026-07-26',
              project_id: 'project-1',
              archived_at: null,
              created_at: `2026-07-26T0${index}:00:00.000Z`,
            },
          },
          { data: { project_id: 'project-1', archived_at: null } },
        ],
        minute_versions: [
          {
            data: {
              id: `version-${index}`,
              version_no: 1,
              body_md: bodyMd,
              body_hash: bodyHash,
              created_at: `2026-07-26T0${index}:00:00.000Z`,
            },
          },
          { data: { version_no: 1, body_hash: bodyHash } },
        ],
      }
      return {
        from: vi.fn((table: string) =>
          queryBuilder((tables[table] ?? []).shift() ?? { data: null })),
        rpc: vi.fn((name: string) => queryBuilder(
          name === 'claim_wiki_processing_job'
            ? {
                data: {
                  id: 100 + index,
                  project_id: 'project-1',
                  minute_id: `minute-${index}`,
                  minute_version_id: `version-${index}`,
                  body_hash: bodyHash,
                  status: 'running',
                  attempts: 1,
                  max_attempts: 5,
                  locked_by: `worker-${index}`,
                  apply_generation: 0,
                  payload: {},
                },
              }
            : {
                data: {
                  job_id: 100 + index,
                  status: 'done',
                  apply_generation: 0,
                  rerun_requested: false,
                },
              },
        )),
      }
    })
    mocks.createAdminClient
      .mockReturnValueOnce(workerAdmin)
      .mockReturnValueOnce(projectAdmins[0])
      .mockReturnValueOnce(minuteAdmins[0])
      .mockReturnValueOnce(projectAdmins[1])
      .mockReturnValueOnce(minuteAdmins[1])

    await expect(runWikiWorkerOnce(2)).resolves.toEqual({ attempted: 2, completed: 2 })
    for (const [index, minuteAdmin] of minuteAdmins.entries()) {
      expect(minuteAdmin.rpc).toHaveBeenCalledWith(
        'claim_wiki_processing_job',
        expect.objectContaining({ p_job_id: 101 + index }),
      )
      expect(projectAdmins[index].rpc).toHaveBeenCalledWith(
        'finish_wiki_project_rebuild_step',
        expect.objectContaining({ p_last_error: '' }),
      )
    }
  })

  it('force가 예약된 max-attempt stale lease도 finish RPC가 다음 generation pending으로 보존한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const responses: QueryResponse[] = [
      {
        data: [{
          id: 51,
          attempts: 5,
          max_attempts: 5,
          locked_at: '2026-07-25T00:00:00.000Z',
          locked_by: 'expired-worker',
          apply_generation: 2,
          rerun_requested: true,
        }],
      },
      { data: [] },
    ]
    const admin = {
      from: vi.fn(() => queryBuilder(responses.shift() ?? { data: [] })),
      rpc: vi.fn((name: string) => queryBuilder(
        name === 'claim_wiki_project_rebuild_step'
          ? { data: null }
          : {
              data: {
                job_id: 51,
                status: 'pending',
                apply_generation: 2,
                rerun_requested: false,
              },
            },
      )),
    }
    mocks.createAdminClient.mockReturnValue(admin)

    const result = await runWikiWorkerOnce(5)

    expect(result).toEqual({ attempted: 0, completed: 0 })
    expect(admin.rpc).toHaveBeenCalledWith(
      'finish_wiki_processing_job',
      expect.objectContaining({
        p_job_id: 51,
        p_locked_by: 'expired-worker',
        p_succeeded: false,
        p_last_error: 'LEASE_EXPIRED',
      }),
    )
  })

  it('다른 worker가 먼저 lease를 끝낸 40001은 정상 CAS 경합으로 보고 다음 작업을 계속 찾는다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const responses: QueryResponse[] = [
      {
        data: [{
          id: 52,
          attempts: 1,
          max_attempts: 5,
          locked_at: '2026-07-25T00:00:00.000Z',
          locked_by: 'already-finished-worker',
        }],
      },
      { data: [] },
    ]
    const admin = {
      from: vi.fn(() => queryBuilder(responses.shift() ?? { data: [] })),
      rpc: vi.fn((name: string) => queryBuilder(
        name === 'claim_wiki_project_rebuild_step'
          ? { data: null }
          : { error: { code: '40001', message: 'WIKI_JOB_LEASE_LOST' } },
      )),
    }
    mocks.createAdminClient.mockReturnValue(admin)

    await expect(runWikiWorkerOnce(5)).resolves.toEqual({ attempted: 0, completed: 0 })
    expect(admin.from).toHaveBeenCalledTimes(2)
  })
})

describe('processWikiProjectRebuildStep durable cursor', () => {
  it('minute job을 다시 claim하지 못해도 finish RPC의 DB 완료 판정으로 cursor를 전진한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    const projectAdmin = {
      rpc: vi.fn((name: string) => queryBuilder(
        name === 'claim_wiki_project_rebuild_step'
          ? {
              data: {
                claimed_project_id: 'project-1',
                rebuild_generation: 4,
                minute_id: 'minute-1',
                minute_version_id: 'version-1',
                wiki_job_id: 77,
                wiki_apply_generation: 9,
                finished: false,
              },
            }
          : {
              data: {
                rebuilt_project_id: 'project-1',
                rebuild_status: 'pending',
                rebuild_generation: 4,
                cursor_advanced: true,
              },
            },
      )),
    }
    // 다른 worker가 bound minute job을 이미 완료했다면 직접 claim은 null이다.
    const minuteAdmin = {
      rpc: vi.fn(() => queryBuilder({ data: null })),
    }
    mocks.createAdminClient
      .mockReturnValueOnce(projectAdmin)
      .mockReturnValueOnce(minuteAdmin)

    await expect(processWikiProjectRebuildStep('project-1')).resolves.toEqual({
      attempted: true,
      completed: true,
      finished: false,
    })
    expect(projectAdmin.rpc).toHaveBeenNthCalledWith(
      1,
      'claim_wiki_project_rebuild_step',
      expect.objectContaining({ p_project_id: 'project-1' }),
    )
    expect(projectAdmin.rpc).toHaveBeenNthCalledWith(
      2,
      'finish_wiki_project_rebuild_step',
      expect.objectContaining({
        p_project_id: 'project-1',
        p_last_error: 'MINUTE_JOB_NOT_DONE',
      }),
    )
  })
})

describe('parseExtractedWikiItems — 잘린 응답 구제', () => {
  const blocks = [
    { index: 0, hash: 'block-hash-0', text: 'ERP와 MES 연계는 REST API로 확정했다.', rendered: true },
    { index: 1, hash: 'block-hash-1', text: 'UAT는 8월에 진행하기로 합의했다.', rendered: true },
  ]

  it('maxOutputTokens에 잘린 JSON에서도 완결된 항목은 살린다', () => {
    // 두 번째 항목 중간에서 끊긴 응답. JSON.parse는 통째로 실패한다.
    const truncated = '{"items":[{"kind":"decision","topic":"연계","topicType":"interface",'
      + '"statement":"ERP와 MES 연계는 REST API로 확정했다.","knowledgeKey":"연계 방식",'
      + '"certainty":"explicit","decisionState":"confirmed","relation":"supports",'
      + '"semanticRelation":null,"evidence":[0],"ownerTeam":null,"ownerName":null,'
      + '"dueDate":null,"effectiveDate":null},{"kind":"decision","topic":"UAT","stat'

    const items = parseExtractedWikiItems(truncated, blocks)

    expect(items).not.toBeNull()
    expect(items).toHaveLength(1)
    expect(items?.[0].statement).toContain('REST API')
  })

  it('건질 항목이 하나도 없으면 여전히 null이다 — 실패를 성공으로 위장하지 않는다', () => {
    expect(parseExtractedWikiItems('죄송합니다. 요청을 처리할 수 없습니다.', blocks)).toBeNull()
    expect(parseExtractedWikiItems('{"items":[{"kind":"decisi', blocks)).toBeNull()
  })

  it('정상 응답은 기존대로 엄격 파싱한다', () => {
    const valid = JSON.stringify({
      items: [{
        kind: 'decision', topic: '연계', topicType: 'interface',
        statement: 'ERP와 MES 연계는 REST API로 확정했다.', knowledgeKey: '연계 방식',
        certainty: 'explicit', decisionState: 'confirmed', relation: 'supports',
        semanticRelation: null, evidence: [0],
      }],
    })
    expect(parseExtractedWikiItems(valid, blocks)).toHaveLength(1)
  })
})
