import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeAddedAssignees } from '@/lib/domain/inbox'

describe('computeAddedAssignees — 신규 추가분만 알림', () => {
  it('기존에 없던 담당자만 반환', () => {
    expect(computeAddedAssignees(['m1', 'm2'], ['m2', 'm3'])).toEqual(['m3'])
  })
  it('전원 유지면 빈 배열 — 재알림 없음', () => {
    expect(computeAddedAssignees(['m1', 'm2'], ['m1', 'm2'])).toEqual([])
  })
  it('신규 이슈(기존 없음)는 전원', () => {
    expect(computeAddedAssignees([], ['m1', 'm2'])).toEqual(['m1', 'm2'])
  })
  it('해제만 있으면 빈 배열', () => {
    expect(computeAddedAssignees(['m1', 'm2'], ['m1'])).toEqual([])
  })
})

// updateIssue 를 통한 replaceAssignees 발행 배선 검증 — 위 순수 함수가 실제로 연결됐는지 확인.
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 전 createServerClient 호출 금지')
    return state.client
  }),
}))
const { requireProjectMember, requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
const { emitNotification } = vi.hoisted(() => ({ emitNotification: vi.fn(async () => ({ ok: true })) }))
// updateIssueProgress 의 상태 변경 자동 기록이 service_role(createAdminClient) 로 issue_updates 에
// 쓴다 — 이 파일이 지금 status 전환 케이스를 커버하진 않지만, 다른 mock 과 마찬가지로 실제
// supabase-js 생성을 막아둔다(shared helper mock trap 재발 방지).
const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification }))

import { getSession } from '@/lib/auth'
import { updateIssue, updateIssueProgress } from '@/app/actions/issues'

const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const
const ACTOR = { userId: 'me', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['p1', 'member']]) }

const INPUT = {
  title: '테스트 이슈',
  body: '',
  severity: 'medium' as const,
  assigneeMemberIds: ['m1', 'm2'],
  startDate: null,
  dueDate: null,
  megaCode: '00' as const,
  majorName: '기준정보관리',
  subProcess: '기준정보 등록',
  ownerDepartment: '경영관리팀',
  relatedSystems: ['ERP'],
  sourceType: 'interview' as const,
  sourceDetail: '현업 인터뷰',
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  createAdminClient.mockReset()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
  emitNotification.mockClear()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  vi.mocked(getSession).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
})

describe('updateIssue — replaceAssignees diff 발행 배선', () => {
  it('기존 m1 유지 + m2 신규 추가 → m2 만 emitNotification 수신자로 발행', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 'i1', pi_issue_code: null }, error: null })),
        })),
      })),
    }))
    state.client = {
      from: vi.fn((table: string) => {
        if (table === 'issues') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { project_id: 'p1', created_by: 'me', mega_code: '00', source_type: 'interview' },
                })),
              })),
            })),
            update,
          }
        }
        if (table === 'issue_major_processes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: 'major-1' }, error: null })) })),
                })),
              })),
            })),
          }
        }
        if (table === 'issue_assignees') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [{ member_id: 'm1' }], error: null })),
            })),
            delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
            insert: vi.fn(async () => ({ error: null })),
          }
        }
        if (table === 'project_members') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({ data: [{ id: 'm1' }, { id: 'm2' }], error: null })),
              })),
            })),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    }

    const res = await updateIssue('i1', { ...INPUT })

    expect(res).toMatchObject({ ok: true })
    expect(emitNotification).toHaveBeenCalledOnce()
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'issue.assigned',
      recipientMemberIds: ['m2'],
    }))
  })
})

describe('updateIssueProgress — 진행/칸반 경로에서도 담당자 diff 발행', () => {
  it('기존 이슈 조회에서 얻은 title 로 신규 담당자에게만 발행', async () => {
    state.client = {
      from: vi.fn((table: string) => {
        if (table === 'issues') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    project_id: 'p1', created_by: 'other', status: 'open', resolved_at: null,
                    title: '칸반에서 담당 변경',
                  },
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [{ id: 'i1' }], error: null })) })),
            })),
          }
        }
        if (table === 'issue_assignees') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [{ member_id: 'm1' }], error: null })),
            })),
            delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
            insert: vi.fn(async () => ({ error: null })),
          }
        }
        if (table === 'project_members') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({ data: [{ id: 'm1' }, { id: 'm2' }], error: null })),
              })),
            })),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    }

    const res = await updateIssueProgress('i1', { assigneeMemberIds: ['m1', 'm2'] })

    expect(res).toMatchObject({ ok: true })
    expect(emitNotification).toHaveBeenCalledOnce()
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'issue.assigned',
      recipientMemberIds: ['m2'],
      payload: expect.objectContaining({ title: '칸반에서 담당 변경' }),
    }))
  })
})
