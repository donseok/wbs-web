import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSupabaseIndexSourceLister } from '@/lib/ai/index/backfill'

const source = readFileSync(
  new URL('../../src/lib/ai/index/backfill.ts', import.meta.url), 'utf8')

function queryBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of [
    'select', 'upsert', 'update', 'delete', 'eq', 'in', 'is', 'gte', 'lte',
    'not', 'or', 'order', 'limit', 'maybeSingle',
  ]) builder[method] = vi.fn(() => builder)
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject)
  return builder
}

describe('회의록 백필 스코프 — 로더와 같은 규칙을 써야 한다', () => {
  it('열거자가 minutes.project_id 를 읽는다', () => {
    const spec = source.match(/minutes:\s*\{[^}]*\}/)?.[0] ?? ''
    expect(spec).toContain('project_id')
    // meetings 역참조만 있고 자체 컬럼이 없으면 job.projectId 가 null 로 큐잉된다
    expect(spec).not.toMatch(/columns:\s*'id, updated_at, created_at, meetings\(project_id\)'/)
  })

  it('project_id 우선, 없으면 meetings 역참조로 떨어진다 — content.ts:284 와 동일', async () => {
    // 케이스 1: minutes.project_id 가 설정되면 그걸 쓴다 (운영 47/67건의 모양)
    const client1 = { from: vi.fn(() => queryBuilder({ data: [{ id: 'm1', updated_at: '2026-07-19T01:00:00.000Z', created_at: '2026-07-18T00:00:00.000Z', project_id: 'p2', meetings: null }], error: null })), rpc: vi.fn() }
    const lister1 = createSupabaseIndexSourceLister(client1 as never)
    const result1 = await lister1('minutes')
    expect(result1).toMatchObject({ ok: true })
    if (!result1.ok) throw new Error('케이스 1 실패')
    expect(result1.data[0].projectId).toBe('p2')

    // 케이스 2: minutes.project_id 가 null 이면 meetings 에서 떨어진다
    const client2 = { from: vi.fn(() => queryBuilder({ data: [{ id: 'm2', updated_at: '2026-07-19T01:00:00.000Z', created_at: '2026-07-18T00:00:00.000Z', project_id: null, meetings: { project_id: 'p1' } }], error: null })), rpc: vi.fn() }
    const lister2 = createSupabaseIndexSourceLister(client2 as never)
    const result2 = await lister2('minutes')
    expect(result2).toMatchObject({ ok: true })
    if (!result2.ok) throw new Error('케이스 2 실패')
    expect(result2.data[0].projectId).toBe('p1')

    // 케이스 3: 양쪽 다 있으면 minutes.project_id 가 우선 (로더의 `?? meetingProjectId` 규칙)
    const client3 = { from: vi.fn(() => queryBuilder({ data: [{ id: 'm3', updated_at: '2026-07-19T01:00:00.000Z', created_at: '2026-07-18T00:00:00.000Z', project_id: 'p2', meetings: { project_id: 'p9' } }], error: null })), rpc: vi.fn() }
    const lister3 = createSupabaseIndexSourceLister(client3 as never)
    const result3 = await lister3('minutes')
    expect(result3).toMatchObject({ ok: true })
    if (!result3.ok) throw new Error('케이스 3 실패')
    expect(result3.data[0].projectId).toBe('p2')
  })
})
