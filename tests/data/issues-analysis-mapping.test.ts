import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => state.client),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getIssues, getMinuteLinkedIssues } from '@/lib/data/issues'

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return builder
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
})

describe('이슈 분석 메타 DB 매핑', () => {
  it('getIssues가 신규 메타와 0055 이전 null/default 행을 모두 도메인 형태로 매핑한다', async () => {
    const issues = query({
      data: [
        {
          id: 'i1',
          issue_no: 12,
          pi_issue_code: 'PI-I-03-02',
          project_id: 'p-map',
          mega_code: '03',
          mega_seq: 2,
          major_id: 'mj1',
          title: '설계 변경 지연',
          body: '',
          status: 'open',
          severity: 'high',
          start_date: null,
          due_date: null,
          sub_process: '설계 변경',
          owner_department: '품질팀',
          related_systems: ['PLM', 'ERP'],
          source_type: 'deliverable',
          source_detail: 'As-Is 산출물',
          resolution_note: '',
          resolved_at: null,
          created_by: 'u1',
          created_by_name: '홍길동',
          created_at: '2026-07-31T00:00:00Z',
          updated_at: '2026-07-31T00:00:00Z',
        },
        {
          id: 'legacy',
          issue_no: 11,
          pi_issue_code: null,
          project_id: 'p-map',
          mega_code: null,
          mega_seq: null,
          major_id: null,
          title: '기존 이슈',
          body: '',
          status: 'open',
          severity: 'medium',
          start_date: null,
          due_date: null,
          sub_process: '',
          owner_department: '',
          related_systems: [],
          source_type: null,
          source_detail: '',
          resolution_note: '',
          resolved_at: null,
          created_by: null,
          created_by_name: null,
          created_at: '2026-07-30T00:00:00Z',
          updated_at: '2026-07-30T00:00:00Z',
        },
      ],
      error: null,
    })
    const assignees = query({
      data: [{ issue_id: 'i1', member_id: 'm1' }],
      error: null,
    })
    const links = query({ data: [], error: null })
    const majors = query({
      data: [{ id: 'mj1', mega_code: '03', major_seq: 1, name: '설계관리' }],
      error: null,
    })
    state.client = {
      from: vi.fn((table: string) => {
        if (table === 'issues') return issues
        if (table === 'issue_assignees') return assignees
        if (table === 'issue_links') return links
        if (table === 'issue_major_processes') return majors
        throw new Error(`unexpected table: ${table}`)
      }),
    }

    const result = await getIssues('p-map')

    expect(result[0]).toMatchObject({
      piIssueCode: 'PI-I-03-02',
      megaCode: '03',
      megaSeq: 2,
      majorId: 'mj1',
      majorSeq: 1,
      majorName: '설계관리',
      subProcess: '설계 변경',
      ownerDepartment: '품질팀',
      relatedSystems: ['PLM', 'ERP'],
      sourceType: 'deliverable',
      sourceDetail: 'As-Is 산출물',
      assigneeMemberIds: ['m1'],
    })
    expect(result[1]).toMatchObject({
      piIssueCode: null,
      megaCode: null,
      megaSeq: null,
      majorId: null,
      majorSeq: null,
      majorName: null,
      subProcess: '',
      ownerDepartment: '',
      relatedSystems: [],
      sourceType: null,
      sourceDetail: '',
    })
  })

  it('회의록 역링크에도 PI 업무키를 포함하고 기존 null을 보존한다', async () => {
    state.client = {
      from: vi.fn(() => query({
        data: [
          {
            id: 'link-1',
            issue_id: 'i1',
            project_id: 'p-reverse',
            minute_version_id: 'v1',
            body_hash: 'body',
            block_index: 0,
            block_hash: 'block',
            issues: {
              issue_no: 12,
              pi_issue_code: 'PI-I-03-02',
              title: '설계 변경 지연',
              status: 'open',
            },
          },
          {
            id: 'link-2',
            issue_id: 'legacy',
            project_id: 'p-reverse',
            minute_version_id: 'v1',
            body_hash: 'body',
            block_index: 1,
            block_hash: 'block2',
            issues: [{
              issue_no: 11,
              pi_issue_code: null,
              title: '기존 이슈',
              status: 'open',
            }],
          },
        ],
        error: null,
      })),
    }

    const result = await getMinuteLinkedIssues('minute-reverse')

    expect(result.map(({ issueId, piIssueCode }) => ({ issueId, piIssueCode }))).toEqual([
      { issueId: 'i1', piIssueCode: 'PI-I-03-02' },
      { issueId: 'legacy', piIssueCode: null },
    ])
  })
})
