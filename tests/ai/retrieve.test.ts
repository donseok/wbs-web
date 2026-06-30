import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/ai/provider', () => ({ hasEmbeddings: vi.fn() }))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { hasEmbeddings } from '@/lib/ai/provider'
import { embedTexts } from '@/lib/ai/embeddings'
import { createAdminClient } from '@/lib/supabase/admin'
import { retrieveContext } from '@/lib/ai/retrieve'

const mHasEmb = vi.mocked(hasEmbeddings)
const mEmbed = vi.mocked(embedTexts)
const mAdmin = vi.mocked(createAdminClient)

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
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('임베딩이 null 이면 []', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue(null)
    expect(await retrieveContext('q', 'p1')).toEqual([])
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('RPC 성공 → Match[] 로 매핑', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    const rpc = vi.fn(async () => ({
      data: [{ id: 'e1', project_id: 'p1', kind: 'wbs_item', ref_id: 'w1', content: '작업 A', similarity: 0.83 }],
      error: null,
    }))
    mAdmin.mockReturnValue({ rpc } as never)
    const out = await retrieveContext('q', 'p1', 8)
    expect(rpc).toHaveBeenCalledWith('match_wbs_documents', expect.objectContaining({ p_project_id: 'p1', match_count: 8 }))
    expect(out).toEqual([{ kind: 'wbs_item', refId: 'w1', content: '작업 A', similarity: 0.83, projectId: 'p1' }])
  })

  it('마이그레이션 미적용(테이블 부재)이면 [] + 안내 로그', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    mAdmin.mockReturnValue({
      rpc: vi.fn(async () => ({ data: null, error: { code: '42P01', message: 'relation "wbs_embeddings" does not exist' } })),
    } as never)
    const errSpy = vi.spyOn(console, 'error')
    expect(await retrieveContext('q', 'p1')).toEqual([])
    expect(errSpy.mock.calls.flat().map(String).join(' ')).toMatch(/마이그레이션/)
  })

  it('service_role 미설정 등으로 admin 생성이 throw 해도 500 대신 [] (그레이스풀 폴백)', async () => {
    mHasEmb.mockReturnValue(true)
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    mAdmin.mockImplementation(() => {
      throw new Error('Supabase service_role 환경변수가 설정되지 않았습니다.')
    })
    await expect(retrieveContext('q', 'p1')).resolves.toEqual([])
  })
})
