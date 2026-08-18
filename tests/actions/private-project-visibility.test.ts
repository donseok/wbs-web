import { describe, it, expect, vi, beforeEach } from 'vitest'

// 비공개 프로젝트(0070) — listProjects 길목 필터 검증.
// 판정은 순수 계층(canSeeProject)의 실제 규칙을 쓰고, IO(DB·actor 상태)만 모킹한다.
// listProjectsWithState 는 getSession 선행 게이트 없이 fetchProjects 와 getActorViewState 를
// 병렬 실행한다(2026-08-18 성능 리팩터) — 비로그인은 { actor: null, degraded: false } 로 표현된다.
const { getActorViewState, requireProjectAdmin, requireSuperuser } = vi.hoisted(() => ({
  getActorViewState: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(),
}))
const { createServerClient, createAdminClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(), createAdminClient: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorViewState, requireProjectAdmin, requireSuperuser }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import type { Actor } from '@/lib/domain/authz'
import { listProjectsWithState } from '@/app/actions/project'

const PUB = { id: 'p-pub', name: '공개', is_private: false }
const PRIV = { id: 'p-priv', name: '비공개', is_private: true }

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: null, teamId: null, isSuperuser: false,
  projectRoles: new Map(), rosterTeams: new Map(), ...over,
})

const viewState = (a: Actor | null, degraded = false) => ({ actor: a, degraded })

function stubProjects(rows: unknown[], error: { message: string } | null = null) {
  createServerClient.mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order: vi.fn(async () => ({ data: error ? null : rows, error })) })),
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  stubProjects([PUB, PRIV])
})

describe('listProjectsWithState — 비공개 프로젝트 필터', () => {
  it('역할 없는 사용자(viewer)에게는 비공개가 목록에서 빠진다', async () => {
    getActorViewState.mockResolvedValue(viewState(actor({})))
    const { projects, degraded } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub'])
    expect(degraded).toBe(false)
  })
  it('해당 프로젝트 멤버에게는 보인다', async () => {
    getActorViewState.mockResolvedValue(viewState(actor({ projectRoles: new Map([['p-priv', 'member']]) })))
    const { projects } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub', 'p-priv'])
  })
  it('슈퍼유저에게는 보인다', async () => {
    getActorViewState.mockResolvedValue(viewState(actor({ isSuperuser: true })))
    const { projects } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub', 'p-priv'])
  })
  it('비로그인(actor null · degraded false)이면 빈 목록을 정상 상태로 돌려준다', async () => {
    getActorViewState.mockResolvedValue(viewState(null, false))
    const { projects, degraded } = await listProjectsWithState()
    expect(projects).toEqual([])
    expect(degraded).toBe(false)
  })
  it('권한 조회 실패(actor null · degraded true)면 비공개만 빠지고 공개 목록은 유지 — fail-closed', async () => {
    getActorViewState.mockResolvedValue(viewState(null, true))
    const { projects, degraded } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub'])
    expect(degraded).toBe(false) // degraded 는 목록 조회 실패 신호 — 권한 열화와 별개(기존 시맨틱)
  })
  it('is_private 컬럼이 없는 행(마이그레이션 전)은 공개로 취급 — 배포 순서 안전', async () => {
    stubProjects([{ id: 'p-old', name: '구형' }])
    getActorViewState.mockResolvedValue(viewState(actor({})))
    const { projects } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-old'])
  })
  it('조회 실패는 여전히 degraded 로 드러난다', async () => {
    stubProjects([], { message: 'boom' })
    getActorViewState.mockResolvedValue(viewState(actor({})))
    const { projects, degraded } = await listProjectsWithState()
    expect(projects).toEqual([])
    expect(degraded).toBe(true)
  })
})
