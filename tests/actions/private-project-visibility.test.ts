import { describe, it, expect, vi, beforeEach } from 'vitest'

// 비공개 프로젝트(0070) — listProjects 길목 필터 검증.
// 판정은 순수 계층(canSeeProject)의 실제 규칙을 쓰고, IO(세션·DB·actor)만 모킹한다.
const { getActorForView, requireProjectAdmin, requireSuperuser } = vi.hoisted(() => ({
  getActorForView: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(),
}))
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
const { createServerClient, createAdminClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(), createAdminClient: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorForView, requireProjectAdmin, requireSuperuser }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import type { Actor } from '@/lib/domain/authz'
import { listProjectsWithState } from '@/app/actions/project'

const PUB = { id: 'p-pub', name: '공개', is_private: false }
const PRIV = { id: 'p-priv', name: '비공개', is_private: true }

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: null, teamId: null, isSuperuser: false,
  projectRoles: new Map(), ...over,
})

function stubProjects(rows: unknown[], error: { message: string } | null = null) {
  createServerClient.mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order: vi.fn(async () => ({ data: error ? null : rows, error })) })),
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 'u1' })
  stubProjects([PUB, PRIV])
})

describe('listProjectsWithState — 비공개 프로젝트 필터', () => {
  it('역할 없는 사용자(viewer)에게는 비공개가 목록에서 빠진다', async () => {
    getActorForView.mockResolvedValue(actor({}))
    const { projects, degraded } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub'])
    expect(degraded).toBe(false)
  })
  it('해당 프로젝트 멤버에게는 보인다', async () => {
    getActorForView.mockResolvedValue(actor({ projectRoles: new Map([['p-priv', 'member']]) }))
    const { projects } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub', 'p-priv'])
  })
  it('슈퍼유저에게는 보인다', async () => {
    getActorForView.mockResolvedValue(actor({ isSuperuser: true }))
    const { projects } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub', 'p-priv'])
  })
  it('권한 조회 실패(actor null)면 비공개만 빠지고 공개 목록은 유지 — fail-closed', async () => {
    getActorForView.mockResolvedValue(null)
    const { projects, degraded } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-pub'])
    expect(degraded).toBe(false)
  })
  it('is_private 컬럼이 없는 행(마이그레이션 전)은 공개로 취급 — 배포 순서 안전', async () => {
    stubProjects([{ id: 'p-old', name: '구형' }])
    getActorForView.mockResolvedValue(actor({}))
    const { projects } = await listProjectsWithState()
    expect(projects.map((p: { id: string }) => p.id)).toEqual(['p-old'])
  })
  it('조회 실패는 여전히 degraded 로 드러난다', async () => {
    stubProjects([], { message: 'boom' })
    getActorForView.mockResolvedValue(actor({}))
    const { projects, degraded } = await listProjectsWithState()
    expect(projects).toEqual([])
    expect(degraded).toBe(true)
  })
})
