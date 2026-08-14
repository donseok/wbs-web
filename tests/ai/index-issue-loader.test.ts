import { describe, expect, it } from 'vitest'
import { BOT_DOMAINS, BOT_ENTITY_TYPES } from '@/lib/ai/chat/protocol'
import { INDEX_BACKFILL_DOMAINS } from '@/lib/ai/index/backfill'
import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const ISSUE = '33333333-3333-3333-3333-333333333333'

function client(row: Record<string, unknown> | null) {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) builder[m] = () => builder
  builder.maybeSingle = async () => ({ data: row, error: null })
  return { from: () => builder } as never
}

const job = {
  entityType: 'issue', entityId: ISSUE, projectId: PROJECT,
  domain: 'issues', operation: 'upsert' as const,
} as never

describe('이슈 색인 배선', () => {
  it('도메인·엔티티 어휘의 단일 원천에 issues/issue 가 있다', () => {
    expect(BOT_DOMAINS).toContain('issues')
    expect(BOT_ENTITY_TYPES).toContain('issue')
  })

  it('백필 열거 도메인에 issues 가 있다', () => {
    expect(INDEX_BACKFILL_DOMAINS).toContain('issues')
  })

  it('로더가 이슈 본문을 스냅샷으로 만든다', async () => {
    const load = createSupabaseIndexContentLoader(client({
      id: ISSUE, project_id: PROJECT, issue_no: 42, title: 'MES 권한 신청 절차',
      body: '계정 발급은 IT팀 경유', status: 'open', severity: 'high',
      owner_department: '부산운영팀', created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
    }))
    const result = await load(job)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('스냅샷이 없다')
    // IndexContentSnapshot 은 { documents, sourceUpdatedAt } 이다(types.ts:198-201).
    // title·href 는 스냅샷이 아니라 documents[0] 에 있다.
    const [doc] = result.data.documents
    expect(doc.title).toContain('MES 권한 신청 절차')
    expect(doc.href).toContain(`/p/${PROJECT}/issues`)
  })

  it('다른 프로젝트의 이슈면 내용 노출 전에 끊는다', async () => {
    const load = createSupabaseIndexContentLoader(client({
      id: ISSUE, project_id: '99999999-9999-9999-9999-999999999999', title: '남의 이슈',
    }))
    const result = await load(job)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('통과하면 안 된다')
    expect(result.errorCode).toBe('INDEX_CONTENT_SCOPE_MISMATCH')
  })

  it('연관 시스템과 업무키를 본문에 포함한다', async () => {
    const load = createSupabaseIndexContentLoader(client({
      id: ISSUE, project_id: PROJECT, issue_no: 42, title: 'MES 관련 이슈',
      body: 'MES가 안 나온다', status: 'open', severity: 'high',
      owner_department: '부산운영팀', created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      related_systems: ['MES', 'SAP'], pi_issue_code: 'OPS-001',
    }))
    const result = await load(job)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('스냅샷이 없다')
    const [doc] = result.data.documents
    expect(doc.content).toContain('연관 시스템: MES, SAP')
    expect(doc.content).toContain('업무키: OPS-001')
  })

  it('빈 연관 시스템 배열이면 줄을 넣지 않는다', async () => {
    const load = createSupabaseIndexContentLoader(client({
      id: ISSUE, project_id: PROJECT, issue_no: 43, title: '단순 이슈',
      body: '내용', status: 'open', severity: 'low',
      owner_department: '운영팀', created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      related_systems: [], pi_issue_code: 'OPS-002',
    }))
    const result = await load(job)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('스냅샷이 없다')
    const [doc] = result.data.documents
    expect(doc.content).not.toContain('연관 시스템:')
    expect(doc.content).toContain('업무키: OPS-002')
  })
})
