import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/ai/provider', () => ({ hasEmbeddings: vi.fn() }))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { hasEmbeddings } from '@/lib/ai/provider'
import { embedTexts } from '@/lib/ai/embeddings'
import { createServerClient } from '@/lib/supabase/server'
import { retrieveContext } from '@/lib/ai/retrieve'

const mHasEmb = vi.mocked(hasEmbeddings)
const mEmbed = vi.mocked(embedTexts)
const mServer = vi.mocked(createServerClient)

describe('retrieveContext — 의미검색 (항상 그레이스풀)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('임베딩 키 없으면 임베딩/RPC 호출 없이 []', async () => {
    mHasEmb.mockReturnValue(false)
    expect(await retrieveContext('q', 'p1')).toEqual([])
    expect(mEmbed).not.toHaveBeenCalled()
    expect(mServer).not.toHaveBeenCalled()
  })

  it('임베딩이 null 이면 []', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue(null)
    expect(await retrieveContext('q', 'p1')).toEqual([])
    expect(mServer).not.toHaveBeenCalled()
  })

  it('RPC 성공 → Match[] 로 매핑 (RLS 사용자 클라이언트 사용)', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    const rpc = vi.fn(async () => ({
      data: [{ id: 'e1', project_id: 'p1', kind: 'wbs_item', ref_id: 'w1', content: '작업 A', similarity: 0.83 }],
      error: null,
    }))
    mServer.mockResolvedValue({ rpc } as never)
    const out = await retrieveContext('q', 'p1', 8)
    expect(rpc).toHaveBeenCalledWith('match_wbs_documents', expect.objectContaining({ p_project_id: 'p1', match_count: 8 }))
    expect(out).toEqual([{ kind: 'wbs_item', refId: 'w1', content: '작업 A', similarity: 0.83, projectId: 'p1' }])
  })

  it('유사도가 임계값 미만인 약한 매칭은 제외한다', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    const rpc = vi.fn(async () => ({
      data: [
        { id: 'e1', project_id: 'p1', kind: 'wbs_item', ref_id: 'w1', content: '관련 작업', similarity: 0.71 },
        { id: 'e2', project_id: 'p1', kind: 'wbs_item', ref_id: 'w2', content: '무관 작업', similarity: 0.21 },
      ],
      error: null,
    }))
    mServer.mockResolvedValue({ rpc } as never)
    const out = await retrieveContext('q', 'p1')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ refId: 'w1', similarity: 0.71 })
  })

  it('마이그레이션 미적용(테이블 부재)이면 [] + 안내 로그', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    mServer.mockResolvedValue({
      rpc: vi.fn(async () => ({ data: null, error: { code: '42P01', message: 'relation "wbs_embeddings" does not exist' } })),
    } as never)
    const errSpy = vi.spyOn(console, 'error')
    expect(await retrieveContext('q', 'p1')).toEqual([])
    expect(errSpy.mock.calls.flat().map(String).join(' ')).toMatch(/마이그레이션/)
  })

  it('세션/연결 문제로 클라이언트 생성이 throw 해도 500 대신 [] (그레이스풀 폴백)', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    mServer.mockRejectedValue(new Error('cookies() 호출 컨텍스트 없음'))
    await expect(retrieveContext('q', 'p1')).resolves.toEqual([])
  })
})
