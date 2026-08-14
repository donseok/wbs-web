import { describe, expect, it, vi } from 'vitest'
import { createLexicalSearch, toFusionCandidate } from '@/lib/ai/index/lexical'

const PROJECT = '11111111-1111-1111-1111-111111111111'

function client(response: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => response) } as never
}

const row = {
  id: 'r1', project_id: PROJECT, domain: 'minutes', entity_type: 'minute',
  entity_id: 'm1', chunk_no: 3, title: '정례 회의', content: '계정 발급',
  href: '/m/m1', occurred_on: '2026-07-01', similarity: 0.8,
}

describe('createLexicalSearch', () => {
  it('RPC 결과를 FusionCandidate 로 옮긴다', async () => {
    const search = createLexicalSearch(client({ data: [row], error: null }))
    const result = await search({ tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('실패하면 안 된다')
    expect(result.candidates[0]).toMatchObject({
      entityId: 'm1', chunkNo: 3, domain: 'minutes', title: '정례 회의',
    })
  })

  it('projectIds 가 비면 RPC 를 부르지 않는다 — 빈 스코프는 전체 허용이 아니다', async () => {
    const c = client({ data: [row], error: null })
    const search = createLexicalSearch(c)
    const result = await search({ tokens: ['계정'], projectIds: [], limit: 20 })
    expect(result).toEqual({ ok: true, candidates: [] })
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('토큰이 비면 RPC 를 부르지 않는다', async () => {
    const c = client({ data: [row], error: null })
    const result = await createLexicalSearch(c)({ tokens: [], projectIds: [PROJECT], limit: 20 })
    expect(result).toEqual({ ok: true, candidates: [] })
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })

  it('RPC 오류를 조용히 빈 결과로 위장하지 않는다', async () => {
    const search = createLexicalSearch(client({ data: null, error: { message: 'boom' } }))
    const result = await search({ tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    expect(result).toMatchObject({ ok: false, errorCode: 'LEXICAL_SEARCH_FAILED' })
  })

  it('형태가 깨진 행은 버리되 나머지는 살린다', async () => {
    const search = createLexicalSearch(client({ data: [{ id: 'x' }, row], error: null }))
    const result = await search({ tokens: ['계정'], projectIds: [PROJECT], limit: 20 })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('실패하면 안 된다')
    expect(result.candidates).toHaveLength(1)
  })
})
