import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMembership: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getMembership: mocks.getMembership }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ rpc: mocks.rpc }),
}))

const { curateWikiItem, mergeWikiTopics } = await import('@/app/actions/wiki')

const ARGS = {
  projectId: 'project-1',
  topicId: 'topic-1',
  itemId: 'item-1',
} as const

beforeEach(() => {
  mocks.getMembership.mockReset()
  mocks.rpc.mockReset()
  mocks.revalidatePath.mockReset()
  mocks.rpc.mockResolvedValue({ data: null, error: null })
})

describe('curateWikiItem — 세션 fail-closed + 동작 화이트리스트', () => {
  it('멤버십이 없으면 RPC를 호출하지 않는다', async () => {
    mocks.getMembership.mockResolvedValue(null)

    const result = await curateWikiItem({ ...ARGS, action: 'resolve' })

    expect(result).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('허용 목록에 없는 동작은 DB까지 가지 않는다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pm', teamCode: 'ERP', teamId: 't1' })

    const result = await curateWikiItem({
      ...ARGS,
      action: 'delete' as never,
    })

    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('정상 요청은 RPC 호출 후 홈과 주제 상세를 모두 재검증한다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pm', teamCode: 'ERP', teamId: 't1' })

    const result = await curateWikiItem({ ...ARGS, action: 'archive', reason: '오추출' })

    expect(result).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledWith('curate_wiki_item', {
      p_item_id: 'item-1',
      p_action: 'archive',
      p_reason: '오추출',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/p/project-1/wiki')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/p/project-1/wiki/topics/topic-1')
  })

  it('RPC 실패는 원인을 삼키지 않고 사용자 문구로 옮긴다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pm', teamCode: 'ERP', teamId: 't1' })
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'WIKI_CURATE_INVALID_TRANSITION' },
    })

    const result = await curateWikiItem({ ...ARGS, action: 'resolve' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('할 수 없는 작업')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('마이그레이션 미적용 환경은 일반 실패로 뭉뚱그리지 않는다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pm', teamCode: 'ERP', teamId: 't1' })
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'PGRST202: function does not exist' },
    })

    const result = await curateWikiItem({ ...ARGS, action: 'lock' })

    expect(result.error).toContain('배포되지 않았')
  })
})

describe('mergeWikiTopics — pmo_admin 전용', () => {
  it('일반 멤버는 RPC 앞에서 막힌다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pm', teamCode: 'ERP', teamId: 't1' })

    const result = await mergeWikiTopics({
      projectId: 'project-1',
      sourceTopicId: 'a',
      targetTopicId: 'b',
    })

    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('같은 주제끼리는 병합하지 않는다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't0' })

    const result = await mergeWikiTopics({
      projectId: 'project-1',
      sourceTopicId: 'a',
      targetTopicId: 'a',
    })

    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('PMO 관리자는 병합하고 원본·정본 주제를 모두 재검증한다', async () => {
    mocks.getMembership.mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't0' })

    const result = await mergeWikiTopics({
      projectId: 'project-1',
      sourceTopicId: 'a',
      targetTopicId: 'b',
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledWith('merge_wiki_topics', {
      p_source_topic_id: 'a',
      p_target_topic_id: 'b',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/p/project-1/wiki/topics/a')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/p/project-1/wiki/topics/b')
  })
})
