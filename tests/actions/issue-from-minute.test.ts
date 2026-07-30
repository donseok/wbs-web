import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'

const state = vi.hoisted(() => ({
  client: undefined as unknown,
  admin: undefined as unknown,
}))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('검증 전 DB 접근 금지')
    return state.client
  }),
}))
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    if (state.admin === undefined) throw new Error('원문 검증 전 service_role 접근 금지')
    return state.admin
  }),
}))

const { requireProjectMember, requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { getSession } from '@/lib/auth'
import { createIssueFromMinuteBlock, fetchIssueProjectMembers } from '@/app/actions/issues'

const USER = { id: 'user-1', email: 'user@example.com', user_metadata: { name: '홍길동' } } as const
const ACTOR = { userId: USER.id, teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['project-1', 'member']]) }
const BODY = '# 제목\n\n인터페이스 전환 지연 위험을 담당자와 확인한다.'
const BODY_HASH = fnv1a64(BODY)
const BLOCK = splitMinuteBlocks(BODY)[1]
const INPUT = {
  title: '인터페이스 전환 지연 위험',
  body: BLOCK.text,
  severity: 'high' as const,
  assigneeMemberIds: ['member-1'],
  startDate: '2026-07-27',
  dueDate: '2026-08-03',
}
const SOURCE = {
  minuteId: 'minute-1',
  minuteVersionId: 'version-1',
  bodyHash: BODY_HASH,
  blockIndex: BLOCK.index,
  blockHash: BLOCK.hash,
  kind: 'risk' as const,
}

function clientsWithVersion({
  currentProjectId = 'project-1',
  versionProjectId = 'project-1',
  archivedAt = null,
}: {
  currentProjectId?: string | null
  versionProjectId?: string | null
  archivedAt?: string | null
} = {}) {
  const rpcSingle = vi.fn(async () => ({
    data: { issue_id: 'issue-1', issue_no: 27 },
    error: null,
  }))
  const rpc = vi.fn(() => ({ single: rpcSingle }))
  const admin = { rpc, rpcSingle }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'minute_versions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: SOURCE.minuteVersionId,
                    minute_id: SOURCE.minuteId,
                    body_md: BODY,
                    body_hash: BODY_HASH,
                    project_id: versionProjectId,
                  },
                  error: null,
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'minutes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  project_id: currentProjectId,
                  archived_at: archivedAt,
                },
                error: null,
              })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  }
  return { client, admin }
}

/** 이 프로젝트의 멤버 — 회의록 블록에서 이슈를 등록할 수 있는 최소 자격. */
function asMember() {
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  getActor.mockResolvedValue(ACTOR)
}

beforeEach(() => {
  state.client = undefined
  state.admin = undefined
  createServerClient.mockClear()
  createAdminClient.mockClear()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'project-1' })
  vi.mocked(getSession).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
})

describe('createIssueFromMinuteBlock', () => {
  it('프로젝트 역할이 없는 사용자는 DB에 접근하기 전에 거부한다', async () => {
    requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)
    expect(result).toMatchObject({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('project-1')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('서버가 불변 원문을 재검증하고 원자 생성 RPC를 호출한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result).toEqual({ ok: true, id: 'issue-1', issueNo: 27 })
    expect(fixture.admin.rpc).toHaveBeenCalledWith('create_issue_from_minute_block', expect.objectContaining({
      p_project_id: 'project-1',
      p_actor_id: USER.id,
      p_minute_id: SOURCE.minuteId,
      p_minute_version_id: SOURCE.minuteVersionId,
      p_body_hash: BODY_HASH,
      p_block_index: BLOCK.index,
      p_block_hash: BLOCK.hash,
      p_excerpt_snapshot: BLOCK.text,
      p_source_kind: 'risk',
      p_start_date: '2026-07-27',
      p_due_date: '2026-08-03',
    }))
  })

  it('현재 회의록 프로젝트와 대상 프로젝트가 다르면 생성하지 않는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ currentProjectId: 'other-project' })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(false)
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('회의록을 옮긴 뒤에도 과거 버전 프로젝트는 출처 스냅샷으로만 취급한다', async () => {
    asMember()
    const fixture = clientsWithVersion({
      currentProjectId: 'project-1',
      versionProjectId: 'old-project',
    })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(true)
    expect(fixture.admin.rpc).toHaveBeenCalledOnce()
  })

  it('보관된 회의록에서는 생성하지 않는다', async () => {
    asMember()
    const fixture = clientsWithVersion({ archivedAt: '2026-07-27T00:00:00Z' })
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, SOURCE)

    expect(result.ok).toBe(false)
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })

  it('클라이언트가 조작한 블록 해시는 생성 전에 거부한다', async () => {
    asMember()
    const fixture = clientsWithVersion()
    state.client = fixture.client
    state.admin = fixture.admin

    const result = await createIssueFromMinuteBlock('project-1', INPUT, {
      ...SOURCE,
      blockHash: '0000000000000000',
    })

    expect(result.ok).toBe(false)
    expect(fixture.admin.rpc).not.toHaveBeenCalled()
  })
})

describe('fetchIssueProjectMembers', () => {
  it('조회 실패를 정상적인 빈 담당자 목록과 구분한다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    asMember()
    state.client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: null,
              error: { message: 'temporary failure' },
            })),
          })),
        })),
      })),
    }

    const result = await fetchIssueProjectMembers('project-1')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('담당자 목록')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
