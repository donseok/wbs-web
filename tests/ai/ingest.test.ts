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

type Row = { project_id: string; kind: string; ref_id: string | null; content: string; embedding: number[]; updated_at: string }
function mockAdmin(upsertError: { message: string } | null = null) {
  const lt = vi.fn(async () => ({ error: null }))
  const eq = vi.fn(() => ({ lt }))
  const del = vi.fn(() => ({ eq }))
  const upsert = vi.fn<(rows: Row[], opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>>(
    async () => ({ error: upsertError }),
  )
  mAdmin.mockReturnValue({ from: vi.fn(() => ({ delete: del, upsert })) } as never)
  return { lt, eq, del, upsert }
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

  it('정상 경로: upsert(문서 키 충돌 갱신) 후 이번 라운드에 없던 stale 행만 삭제, count 반환', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([
      { kind: 'project', refId: null, content: 'doc1' },
      { kind: 'wbs_item', refId: 'w1', content: 'doc2' },
    ])
    mEmbed.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    const { lt, eq, del, upsert } = mockAdmin()

    const r = await ingestProject('p1')
    expect(r).toEqual({ count: 2 })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'project_id,kind,ref_id' })
    const rows = upsert.mock.calls[0][0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ project_id: 'p1', embedding: [0.1, 0.2] })
    expect(typeof rows[0].updated_at).toBe('string')
    // stale 정리는 upsert 성공 후: 같은 라운드 타임스탬프보다 오래된 행만 삭제
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(lt).toHaveBeenCalledWith('updated_at', rows[0].updated_at)
  })

  it('upsert 실패 시 stale 삭제를 건너뛴다 — 기존 색인은 스테일로 보존(무색인 방지)', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([{ kind: 'wbs_item', refId: 'w1', content: 'doc1' }])
    mEmbed.mockResolvedValue([[0.1, 0.2]])
    const { del } = mockAdmin({ message: 'insert 실패' })

    await expect(ingestProject('p1')).rejects.toThrow('insert 실패')
    expect(del).not.toHaveBeenCalled()
  })

  it('부분 성공: 일부 항목 임베딩 실패(null)면 성공분만 삽입하고 skippedItems 보고', async () => {
    mHasEmb.mockReturnValue(true)
    mDocs.mockReturnValue([
      { kind: 'project', refId: null, content: 'doc1' },
      { kind: 'wbs_item', refId: 'w1', content: 'doc2' },
      { kind: 'wbs_item', refId: 'w2', content: 'doc3' },
    ])
    mEmbed.mockResolvedValue([[0.1, 0.2], null, [0.5, 0.6]]) // 가운데 항목 실패
    const { del, upsert } = mockAdmin()

    const r = await ingestProject('p1')
    expect(r).toEqual({ count: 2, skippedItems: 1 })
    expect(del).toHaveBeenCalled()
    const rows = upsert.mock.calls[0][0]
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
