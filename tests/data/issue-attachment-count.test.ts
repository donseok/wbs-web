import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => state.client),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getIssues } from '@/lib/data/issues'

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

const ISSUE_ROW = {
  id: 'i1', issue_no: 1, pi_issue_code: null, project_id: 'p1',
  mega_code: null, mega_seq: null, major_id: null,
  title: '이슈', body: '', status: 'open', severity: 'medium',
  start_date: null, due_date: null, sub_process: '', owner_department: '',
  related_systems: [], source_type: null, source_detail: null,
  resolution_note: null, resolved_at: null,
  created_by: 'u1', created_by_name: '홍길동',
  created_at: '2026-08-05T00:00:00Z', updated_at: '2026-08-05T00:00:00Z',
}

/** issues 두 건 + 첨부 조회 결과를 갈아끼우는 클라이언트. */
function clientWith(attachments: { data: unknown; error: { message: string } | null }) {
  const empty = query({ data: [], error: null })
  const issues = query({
    data: [ISSUE_ROW, { ...ISSUE_ROW, id: 'i2', issue_no: 2 }],
    error: null,
  })
  const attach = query(attachments)
  return {
    attach,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'issues') return issues
        if (table === 'issue_attachments') return attach
        return empty
      }),
    },
  }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
})

describe('getIssues 첨부 개수', () => {
  it('이슈별 첨부 개수를 세어 붙인다', async () => {
    const { client } = clientWith({
      data: [{ issue_id: 'i1' }, { issue_id: 'i1' }, { issue_id: 'i2' }],
      error: null,
    })
    state.client = client
    const out = await getIssues('p1')
    expect(out.find(i => i.id === 'i1')?.attachmentCount).toBe(2)
    expect(out.find(i => i.id === 'i2')?.attachmentCount).toBe(1)
  })

  it('첨부가 없는 이슈는 0 이다 — undefined 를 남기지 않는다', async () => {
    const { client } = clientWith({ data: [], error: null })
    state.client = client
    const out = await getIssues('p1')
    expect(out.map(i => i.attachmentCount)).toEqual([0, 0])
  })

  it('프로젝트 단위 한 방으로 조회한다 — 이슈 id 목록을 기다리지 않는다', async () => {
    // .in('issue_id', ids) 를 쓰면 issues 결과를 기다려야 해서 Promise.all 병렬이 깨진다.
    const { client, attach } = clientWith({ data: [], error: null })
    state.client = client
    await getIssues('p1')
    expect(attach.select).toHaveBeenCalledWith('issue_id')
    expect(attach.eq).toHaveBeenCalledWith('project_id', 'p1')
  })

  it('첨부 조회가 실패해도 목록은 뜨고, 실패를 조용히 삼키지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = clientWith({ data: null, error: { message: 'boom' } })
    state.client = client
    const out = await getIssues('p1')
    expect(out).toHaveLength(2)
    expect(out.every(i => i.attachmentCount === 0)).toBe(true)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('첨부'), 'boom')
    spy.mockRestore()
  })
})
