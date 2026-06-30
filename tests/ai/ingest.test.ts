import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/ai/provider', () => ({ hasEmbeddings: vi.fn() }))
vi.mock('@/lib/ai/embeddings', () => ({ embedDocuments: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn() }))
vi.mock('@/lib/data/members', () => ({ getProjectMembers: vi.fn() }))
vi.mock('@/lib/ai/knowledge', () => ({ getProjectName: vi.fn() }))
vi.mock('@/lib/ai/analytics', () => ({ buildDocuments: vi.fn() }))

import { hasEmbeddings } from '@/lib/ai/provider'
import { embedDocuments } from '@/lib/ai/embeddings'
import { createAdminClient } from '@/lib/supabase/admin'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getProjectName } from '@/lib/ai/knowledge'
import { buildDocuments } from '@/lib/ai/analytics'
import { ingestProject } from '@/lib/ai/ingest'

const mHasEmb = vi.mocked(hasEmbeddings)
const mEmbed = vi.mocked(embedDocuments)
const mAdmin = vi.mocked(createAdminClient)

type Row = { project_id: string; kind: string; ref_id: string | null; content: string; embedding: number[] }
function mockAdmin() {
  const eq = vi.fn(async () => ({ error: null }))
  const del = vi.fn(() => ({ eq }))
  const insert = vi.fn<(rows: Row[]) => Promise<{ error: null }>>(async () => ({ error: null }))
  mAdmin.mockReturnValue({ from: vi.fn(() => ({ delete: del, insert })) } as never)
  return { eq, del, insert }
}
const mWbs = vi.mocked(getComputedWbs)
const mMembers = vi.mocked(getProjectMembers)
const mName = vi.mocked(getProjectName)
const mDocs = vi.mocked(buildDocuments)

describe('ingestProject — 재색인(전체 교체)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mWbs.mockResolvedValue({ items: [], today: '2026-01-01' } as never)
    mMembers.mockResolvedValue([] as never)
    mName.mockResolvedValue('프로젝트 A')
  })
  afterEach(() => vi.restoreAllMocks())

  it('임베딩 키 없으면 skip(no_embedding_key)', async () => {
    mHasEmb.mockReturnValue(false)
    expect(await ingestProject('p1')).toEqual({ count: 0, skipped: true, reason: 'no_embedding_key' })
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('생성할 문서가 없으면 count 0', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([])
    expect(await ingestProject('p1')).toEqual({ count: 0 })
  })

  it('임베딩 키 없음(null)이면 skip(embed_failed)', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([{ kind: 'project', refId: null, content: 'doc' }])
    mEmbed.mockResolvedValue(null)
    expect(await ingestProject('p1')).toEqual({ count: 0, skipped: true, reason: 'embed_failed' })
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('정상 경로: 기존 삭제 후 삽입, count 반환', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([
      { kind: 'project', refId: null, content: 'doc1' },
      { kind: 'wbs_item', refId: 'w1', content: 'doc2' },
    ])
    mEmbed.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    const { eq, del, insert } = mockAdmin()

    const r = await ingestProject('p1')
    expect(r).toEqual({ count: 2 })
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(insert).toHaveBeenCalledTimes(1)
    const rows = insert.mock.calls[0][0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ project_id: 'p1', embedding: [0.1, 0.2] })
  })

  it('부분 성공: 일부 항목 임베딩 실패(null)면 성공분만 삽입하고 skippedItems 보고', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([
      { kind: 'project', refId: null, content: 'doc1' },
      { kind: 'wbs_item', refId: 'w1', content: 'doc2' },
      { kind: 'wbs_item', refId: 'w2', content: 'doc3' },
    ])
    mEmbed.mockResolvedValue([[0.1, 0.2], null, [0.5, 0.6]]) // 가운데 항목 실패
    const { del, insert } = mockAdmin()

    const r = await ingestProject('p1')
    expect(r).toEqual({ count: 2, skippedItems: 1 })
    expect(del).toHaveBeenCalled()
    const rows = insert.mock.calls[0][0]
    expect(rows).toHaveLength(2)
    expect(rows.map(x => x.ref_id)).toEqual([null, 'w2']) // 실패한 w1 은 빠짐
  })

  it('전부 실패: 기존 색인을 지우지 않고 보존(삭제 호출 없음)', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([
      { kind: 'wbs_item', refId: 'w1', content: 'doc1' },
      { kind: 'wbs_item', refId: 'w2', content: 'doc2' },
    ])
    mEmbed.mockResolvedValue([null, null]) // 전 항목 실패(쿼터 소진 등)

    const r = await ingestProject('p1')
    expect(r).toEqual({ count: 0, skipped: true, reason: 'embed_failed', skippedItems: 2 })
    expect(mAdmin).not.toHaveBeenCalled() // delete 가 호출되지 않아 기존 색인 보존
  })
})
