import { beforeEach, describe, expect, it, vi } from 'vitest'

type TableResult = { data: unknown[] | null; error: { message: string } | null }

const state = vi.hoisted(() => ({
  results: {} as Record<string, TableResult>,
}))

function thenableQuery(result: TableResult) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.then = (
    resolve: (value: TableResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return query
}

const createServerClient = vi.hoisted(() => vi.fn(async () => ({
  from: (table: string) => thenableQuery(state.results[table]),
})))

vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { loadIssueAnalysisIssues } from '@/lib/data/issueAnalysis'

const issueRow = {
  id: 'issue-1',
  issue_no: 3,
  project_id: 'project-1',
  title: '기준정보 중복',
  body: '본문',
  status: 'resolved',
  severity: 'medium',
  start_date: null,
  due_date: '2026-08-01',
  resolution_note: '완료',
  resolved_at: '2026-07-30T00:00:00Z',
  created_by: 'user-1',
  created_by_name: '테스터',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-30T00:00:00Z',
  mega_code: '00',
  mega_seq: 2,
  pi_issue_code: 'PI-I-00-02',
  sub_process: '자재 등록',
  owner_department: '기준정보팀',
  related_systems: ['ERP', 'MES'],
  source_type: 'minutes',
  source_detail: '',
}

beforeEach(() => {
  createServerClient.mockClear()
  state.results = {
    issues: { data: [issueRow], error: null },
    issue_assignees: {
      data: [{ issue_id: 'issue-1', member_id: 'member-1' }],
      error: null,
    },
    issue_links: {
      data: [{
        id: 'link-1',
        issue_id: 'issue-1',
        project_id: 'project-1',
        minute_id: 'minute-1',
        minute_version_id: 'version-1',
        minute_version_no: 2,
        minute_title_snapshot: 'PI 회의',
        minute_date_snapshot: '2026-07-20',
        body_hash: 'body-hash',
        block_index: 1,
        block_hash: 'block-hash',
        excerpt_snapshot: '회의록 근거',
        source_kind: 'manual',
        source_key: null,
        created_at: '2026-07-20T00:00:00Z',
      }],
      error: null,
    },
  }
})

describe('loadIssueAnalysisIssues', () => {
  it('이슈·담당자·불변 회의록 스냅샷을 하나의 분석 입력으로 결합한다', async () => {
    const result = await loadIssueAnalysisIssues('project-1')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'issue-1',
      piIssueCode: 'PI-I-00-02',
      megaCode: '00',
      megaSeq: 2,
      status: 'resolved',
      assigneeMemberIds: ['member-1'],
      relatedSystems: ['ERP', 'MES'],
      sourceType: 'minutes',
    })
    expect(result[0].minuteSources[0]).toMatchObject({
      id: 'link-1',
      minuteTitle: 'PI 회의',
      excerpt: '회의록 근거',
    })
  })

  it.each(['issues', 'issue_assignees', 'issue_links'])(
    '%s 조회 하나라도 실패하면 부분 결과 대신 throw한다',
    async table => {
      state.results[table] = { data: null, error: { message: `${table} down` } }
      await expect(loadIssueAnalysisIssues('project-1')).rejects.toThrow('조회 실패')
    },
  )
})
