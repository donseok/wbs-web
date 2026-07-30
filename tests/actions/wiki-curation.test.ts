import { beforeEach, describe, expect, it, vi } from 'vitest'

// Wiki 큐레이션·병합은 해당 프로젝트의 관리자 전용(스펙 §4). 실제 변경은 security definer RPC 가
// 하므로 여기서는 가드와 동작 화이트리스트만 검증한다.
const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  // 대상 항목·주제가 그 프로젝트 것인지 확인하는 선행 조회(from). 기본은 '소속 맞음'.
  from: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}))

/** wiki_items 단건(maybeSingle) / wiki_topics 다건(in) 두 형태를 함께 지원하는 최소 빌더. */
function scopeOk() {
  mocks.from.mockImplementation((table: string) => {
    const result = table === 'wiki_topics'
      ? { data: [{ id: 'topic-1' }, { id: 'topic-2' }], error: null }
      : { data: { id: 'item-1' }, error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'maybeSingle']) b[m] = vi.fn(() => b)
    ;(b as { then: (r: (v: unknown) => void) => void }).then = resolve => resolve(result)
    return b
  })
}

const { curateWikiItem, mergeWikiTopics } = await import('@/app/actions/wiki')

const ARGS = {
  projectId: 'project-1',
  topicId: 'topic-1',
  itemId: 'item-1',
} as const

const ADMIN = {
  userId: 'u-admin', teamCode: 'PMO', teamId: 't0', isSuperuser: false,
  projectRoles: new Map([['project-1', 'admin']]),
}
const asAdmin = () => mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ADMIN })

beforeEach(() => {
  mocks.requireProjectAdmin.mockReset()
  mocks.rpc.mockReset()
  mocks.revalidatePath.mockReset()
  mocks.from.mockReset()
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  scopeOk()
})

describe('curateWikiItem — 관리자 fail-closed + 동작 화이트리스트', () => {
  it.each(['로그인 필요', '권한 없음'])('관리자가 아니면 RPC를 호출하지 않는다(%s)', async (error) => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error })

    const result = await curateWikiItem({ ...ARGS, action: 'resolve' })

    expect(result).toEqual({ ok: false, error })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('허용 목록에 없는 동작은 DB까지 가지 않는다', async () => {
    asAdmin()

    const result = await curateWikiItem({
      ...ARGS,
      action: 'delete' as never,
    })

    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('정상 요청은 RPC 호출 후 홈과 주제 상세를 모두 재검증한다', async () => {
    asAdmin()

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
    asAdmin()
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
    asAdmin()
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'PGRST202: function does not exist' },
    })

    const result = await curateWikiItem({ ...ARGS, action: 'lock' })

    expect(result.error).toContain('배포되지 않았')
  })
})

describe('mergeWikiTopics — 프로젝트 관리자 전용', () => {
  it('관리자가 아니면 RPC 앞에서 막힌다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })

    const result = await mergeWikiTopics({
      projectId: 'project-1',
      sourceTopicId: 'a',
      targetTopicId: 'b',
    })

    expect(result).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('같은 주제끼리는 병합하지 않는다', async () => {
    asAdmin()

    const result = await mergeWikiTopics({
      projectId: 'project-1',
      sourceTopicId: 'a',
      targetTopicId: 'a',
    })

    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('관리자는 병합하고 원본·정본 주제를 모두 재검증한다', async () => {
    asAdmin()

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

describe('대상 결합 — 클라이언트가 보낸 projectId 만으로는 통과하지 못한다', () => {
  it('항목이 그 프로젝트 소속이 아니면 RPC 를 부르지 않는다', async () => {
    asAdmin()
    mocks.from.mockImplementation(() => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'maybeSingle']) b[m] = vi.fn(() => b)
      ;(b as { then: (r: (v: unknown) => void) => void }).then = resolve => resolve({ data: null, error: null })
      return b
    })
    const result = await curateWikiItem({ ...ARGS, action: 'resolve' })
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('소속 확인 조회가 실패하면 중단한다 — 통과시키지 않는다', async () => {
    asAdmin()
    mocks.from.mockImplementation(() => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'maybeSingle']) b[m] = vi.fn(() => b)
      ;(b as { then: (r: (v: unknown) => void) => void }).then =
        resolve => resolve({ data: null, error: { message: 'db down' } })
      return b
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await curateWikiItem({ ...ARGS, action: 'resolve' })
    spy.mockRestore()
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('병합은 두 주제가 모두 그 프로젝트 것이어야 한다 — 하나만 맞으면 거부', async () => {
    asAdmin()
    mocks.from.mockImplementation(() => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'maybeSingle']) b[m] = vi.fn(() => b)
      ;(b as { then: (r: (v: unknown) => void) => void }).then =
        resolve => resolve({ data: [{ id: 'topic-1' }], error: null })
      return b
    })
    const result = await mergeWikiTopics({
      projectId: 'project-1', sourceTopicId: 'topic-1', targetTopicId: 'topic-2',
    })
    expect(result.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
