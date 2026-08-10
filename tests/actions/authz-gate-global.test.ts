import { describe, it, expect, vi, beforeEach } from 'vitest'

// 전역 설정·프로젝트 쓰기 액션의 새 authz 가드 검증.
// 가드(@/lib/authz)는 모킹하되 판정은 순수 계층(@/lib/domain/authz)의 실제 규칙에 위임한다 —
// 그래야 "프로젝트 관리자는 슈퍼유저가 아니다" 같은 새 체계의 의미가 테스트에 박힌다.
const { requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
const { createServerClient, createAdminClient, refreshLlmOverride } = vi.hoisted(() => ({
  // 게이트가 첫 관문이어야 한다 — 통과 전 DB 클라이언트를 만들면 여기서 터진다.
  createServerClient: vi.fn(() => { throw new Error('게이트 통과 전 createServerClient 호출 금지') }),
  createAdminClient: vi.fn(() => { throw new Error('게이트 통과 전 createAdminClient 호출 금지') }),
  refreshLlmOverride: vi.fn(async () => true),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u-session' })), getMembership: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/announcements', () => ({ getTopAnnouncements: vi.fn(async () => []) }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams: vi.fn(async () => true), activeTeamCodesSync: () => [] }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))
vi.mock('@/lib/ai/llm-override', () => ({ refreshLlmOverride }))
vi.mock('@/lib/ai/projectFacts', () => ({ loadProjectFacts: vi.fn(async () => null) }))
vi.mock('@/lib/ai/brief', () => ({
  briefFactsHash: vi.fn(() => 'h'), buildBriefFacts: vi.fn(() => ({})), ensureWeeklyBrief: vi.fn(async () => 'ready'),
}))
vi.mock('@/lib/ai/risk-brief', () => ({ ensureRiskBrief: vi.fn(async () => 'ready'), sanitizeRiskItems: vi.fn(() => []) }))
vi.mock('@/lib/data/aiBriefs', () => ({ getAiBrief: vi.fn(async () => null) }))

import type { Actor } from '@/lib/domain/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { createAnnouncement, updateAnnouncement, deleteAnnouncement, createAnnouncementFromMeeting } from '@/app/actions/announcements'
import { recordAttachment, removeAttachment } from '@/app/actions/attachments'
import { addMember, updateMember, removeMember } from '@/app/actions/members'
import { addTeam, updateTeam, listTeamsAdmin } from '@/app/actions/teams'
import { reindexProjectAction } from '@/app/actions/chat'
import { curateWikiItem, mergeWikiTopics } from '@/app/actions/wiki'
import { ensureProjectBriefAction } from '@/app/actions/brief'
import { ensureRiskBriefAction } from '@/app/actions/risk'
import {
  listLlmProfiles, createLlmProfile, updateLlmProfile, deleteLlmProfile,
  getLlmConfig, saveLlmConfig, testLlmConnection, type LlmProfileInput,
} from '@/app/actions/llmConfig'

const PID = 'project-1'
const DENIED = '권한 없음'
const LOOKUP_FAILED = '권한을 확인할 수 없어 중단했습니다.'

function actor(over: Partial<Actor> & { role?: 'admin' | 'member' | null }): Actor {
  const { role = null, ...rest } = over
  return {
    userId: 'u1', teamCode: 'ERP', teamId: 't-erp', isSuperuser: false,
    projectRoles: new Map(role ? [[PID, role]] : []),
    rosterTeams: new Map(),
    ...rest,
  }
}
const SUPERUSER = actor({ userId: 'u-super', isSuperuser: true })
const PROJECT_ADMIN = actor({ userId: 'u-admin', teamCode: 'PMO', teamId: 't-pmo', role: 'admin' })
const MEMBER = actor({ userId: 'u-mem', role: 'member' })
const VIEWER = actor({ userId: 'u-view' }) // 프로젝트 역할 행 부재 = 조회 전용

/** 이 액터로 로그인한 상태를 만든다 — 가드 3종은 순수 판정에 그대로 위임한다. */
function signedInAs(a: Actor) {
  const deny = { ok: false as const, error: DENIED }
  requireSuperuser.mockImplementation(async () => (a.isSuperuser ? { ok: true, actor: a } : deny))
  requireProjectAdmin.mockImplementation(async (pid: string | null) => (isProjectAdmin(a, pid) ? { ok: true, actor: a } : deny))
  requireProjectMember.mockImplementation(async (pid: string | null) => (isProjectMember(a, pid) ? { ok: true, actor: a } : deny))
  getActor.mockResolvedValue(a)
}

const ANNOUNCEMENT = {
  title: '제목', body: '본문', category: 'general' as const, isPinned: false,
  publishFrom: '2026-07-30', publishTo: '2026-07-31',
}
const MEMBER_INPUT = { name: '홍길동', email: null, teamCode: null, role: 'contributor' as const, title: null }
const LLM_INPUT: LlmProfileInput = { name: 'gemini-기본', preset_id: 'gemini', provider: 'gemini', model: 'gemini-3.5-flash' }

beforeEach(() => {
  vi.clearAllMocks()
  createServerClient.mockImplementation(() => { throw new Error('게이트 통과 전 createServerClient 호출 금지') })
  createAdminClient.mockImplementation(() => { throw new Error('게이트 통과 전 createAdminClient 호출 금지') })
  resolveProjectId.mockResolvedValue({ ok: true, projectId: PID })
  refreshLlmOverride.mockResolvedValue(true)
})

describe('전역 설정은 슈퍼유저 전용 — 프로젝트 관리자도 못 넘는다', () => {
  it('팀 기준정보(addTeam·updateTeam)는 프로젝트 관리자를 거부한다', async () => {
    signedInAs(PROJECT_ADMIN)
    expect(await addTeam('신팀')).toEqual({ ok: false, error: DENIED })
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: DENIED })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('listTeamsAdmin 은 에러 채널이 없어 빈 목록으로 강등하되 사유를 로그에 남긴다', async () => {
    signedInAs(PROJECT_ADMIN)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listTeamsAdmin()).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('봇 재색인은 프로젝트 관리자를 거부한다(전역 인덱스)', async () => {
    signedInAs(PROJECT_ADMIN)
    expect(await reindexProjectAction(PID)).toEqual({ ok: false, error: DENIED })
  })

  it('LLM 설정 7액션 전부 슈퍼유저가 아니면 거부하고 DB에 손대지 않는다', async () => {
    signedInAs(PROJECT_ADMIN)
    const results = [
      await listLlmProfiles(), await createLlmProfile(LLM_INPUT), await updateLlmProfile(1, LLM_INPUT),
      await deleteLlmProfile(1), await getLlmConfig(), await saveLlmConfig({ mode: 'none' }),
    ] as { error?: string }[]
    for (const r of results) expect(r.error).toBe(DENIED)
    expect(await testLlmConnection({ provider: 'gemini', model: 'g' })).toEqual({ success: false, error: DENIED })
    expect(createServerClient).not.toHaveBeenCalled()
    expect(refreshLlmOverride).not.toHaveBeenCalled()
  })

  it('슈퍼유저는 같은 게이트를 통과한다(거부가 전원 차단이 아님을 고정)', async () => {
    signedInAs(SUPERUSER)
    createServerClient.mockReturnValue({
      from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
    } as never)
    expect(await listLlmProfiles()).toEqual({ profiles: [] })
  })
})

describe('프로젝트 쓰기는 관리자 전용 — 멤버·조회 전용은 거부', () => {
  it('멤버는 공지 4액션 모두 거부되고 DB에 손대지 않는다', async () => {
    signedInAs(MEMBER)
    expect(await createAnnouncement(PID, ANNOUNCEMENT)).toEqual({ ok: false, error: DENIED })
    expect(await updateAnnouncement('a1', ANNOUNCEMENT)).toEqual({ ok: false, error: DENIED })
    expect(await deleteAnnouncement('a1')).toEqual({ ok: false, error: DENIED })
    expect(await createAnnouncementFromMeeting('m1', '2026-07-30')).toEqual({ ok: false, error: DENIED })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('대상 행의 프로젝트를 못 읽으면 판정 전에 쓰기를 중단한다', async () => {
    signedInAs(PROJECT_ADMIN)
    resolveProjectId.mockResolvedValue({ ok: false, error: LOOKUP_FAILED })
    expect(await deleteAnnouncement('a1')).toEqual({ ok: false, error: LOOKUP_FAILED })
    expect(await removeMember('mem-1')).toEqual({ ok: false, error: LOOKUP_FAILED })
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버는 멤버 명부 3액션이 거부된다', async () => {
    signedInAs(MEMBER)
    expect(await addMember(PID, MEMBER_INPUT)).toEqual({ ok: false, error: DENIED })
    expect(await updateMember('mem-1', MEMBER_INPUT)).toEqual({ ok: false, error: DENIED })
    expect(await removeMember('mem-1')).toEqual({ ok: false, error: DENIED })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버는 Wiki 큐레이션·병합이 거부되고 RPC 앞에서 막힌다', async () => {
    signedInAs(MEMBER)
    expect(await curateWikiItem({ projectId: PID, topicId: 't1', itemId: 'i1', action: 'resolve' }))
      .toEqual({ ok: false, error: DENIED })
    expect(await mergeWikiTopics({ projectId: PID, sourceTopicId: 'a', targetTopicId: 'b' }))
      .toEqual({ ok: false, error: DENIED })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버는 AI 브리핑·위험 해설을 생성할 수 없다(무료 쿼터 보호, 사유는 로그)', async () => {
    signedInAs(MEMBER)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await ensureProjectBriefAction(PID)).toEqual({ state: 'unavailable' })
    expect(await ensureRiskBriefAction(PID)).toEqual({ status: 'unavailable' })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

describe('산출물 첨부 — 관리자 전체 / 멤버는 자기 팀 담당 항목만', () => {
  /** item_owners 조회 한 번만 응답하는 최소 스텁 — eq() 가 결과를 확정한다. */
  function ownersSb(result: { data: unknown; error: unknown }) {
    return { from: () => ({ select: () => ({ eq: async () => result }) }) }
  }

  it('조회 전용은 첨부 등록·삭제 자격이 없다(멤버 이상 필요)', async () => {
    signedInAs(VIEWER)
    const file = { fileName: 'a.pdf', filePath: 'p/a.pdf', size: 1, mime: 'application/pdf' }
    expect(await recordAttachment('item-1', file)).toEqual({ ok: false, error: DENIED })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('멤버인데 담당 팀 조회가 실패하면 통과시키지 않고 중단한다(fail-closed)', async () => {
    signedInAs(MEMBER)
    createServerClient.mockReturnValue(ownersSb({ data: null, error: { message: 'boom' } }) as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await recordAttachment('item-1', { fileName: 'a.pdf', filePath: 'p/a.pdf', size: 1, mime: 'application/pdf' })
    expect(res).toEqual({ ok: false, error: LOOKUP_FAILED })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('멤버는 자기 팀이 담당이 아닌 항목에 첨부할 수 없다', async () => {
    signedInAs(MEMBER)
    createServerClient.mockReturnValue(ownersSb({ data: [{ team_id: 't-other' }], error: null }) as never)
    const res = await recordAttachment('item-1', { fileName: 'a.pdf', filePath: 'p/a.pdf', size: 1, mime: 'application/pdf' })
    expect(res).toEqual({ ok: false, error: DENIED })
  })

  it('첨부 행 조회가 실패하면 삭제를 중단한다(없음으로 위장 금지)', async () => {
    signedInAs(PROJECT_ADMIN)
    createServerClient.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await removeAttachment('att-1')).toEqual({ ok: false, error: LOOKUP_FAILED })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
