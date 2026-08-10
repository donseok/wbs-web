import { describe, it, expect } from 'vitest'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'

// 비공개 프로젝트(0070) — 챗봇 접근 스코프 제외 규칙.
// 목록에선 숨겼는데 챗봇이 답하면 숨김이 무색해진다 — 스코프가 같은 규칙을 따르는지 검증.

type Tables = {
  projects: { data: unknown; error: { message: string } | null }
  project_roles: { data: unknown; error: { message: string } | null }
  memberships: { data: unknown; error: { message: string } | null }
}

function client(tables: Partial<Tables>): SupabaseServerClient {
  const t: Tables = {
    projects: { data: [], error: null },
    project_roles: { data: [], error: null },
    memberships: { data: { is_superuser: false }, error: null },
    ...tables,
  }
  return {
    from: (table: string) => {
      if (table === 'project_roles') return { select: () => ({ eq: async () => t.project_roles }) }
      if (table === 'memberships') return { select: () => ({ eq: () => ({ maybeSingle: async () => t.memberships }) }) }
      return { select: async () => t.projects }
    },
  } as unknown as SupabaseServerClient
}

const PROJECTS = [
  { id: 'p-pub', is_private: false },
  { id: 'p-priv', is_private: true },
]

describe('accessScope — 비공개 프로젝트 스코프 제외', () => {
  it('역할 없는 사용자의 스코프에서 비공개가 빠진다', async () => {
    const res = await createSupabaseAccessScopeResolver(client({ projects: { data: PROJECTS, error: null } })).resolve('u1')
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-pub'])
  })
  it('역할 보유자는 비공개도 스코프에 들어간다', async () => {
    const res = await createSupabaseAccessScopeResolver(client({
      projects: { data: PROJECTS, error: null },
      project_roles: { data: [{ project_id: 'p-priv' }], error: null },
    })).resolve('u1')
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-pub', 'p-priv'])
  })
  it('슈퍼유저는 전부 들어간다', async () => {
    const res = await createSupabaseAccessScopeResolver(client({
      projects: { data: PROJECTS, error: null },
      memberships: { data: { is_superuser: true }, error: null },
    })).resolve('u1')
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-pub', 'p-priv'])
  })
  it('역할 조회 실패면 비공개만 제외하고 진행 — 공개 프로젝트 질문까지 막지 않는다(fail-closed)', async () => {
    const res = await createSupabaseAccessScopeResolver(client({
      projects: { data: PROJECTS, error: null },
      project_roles: { data: null, error: { message: 'boom' } },
    })).resolve('u1')
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-pub'])
  })
  it('projects 조회 실패는 기존대로 ACCESS_SCOPE_UNAVAILABLE', async () => {
    const res = await createSupabaseAccessScopeResolver(client({
      projects: { data: null, error: { message: 'down' } },
    })).resolve('u1')
    expect(res.ok).toBe(false)
    expect(!res.ok && res.code).toBe('ACCESS_SCOPE_UNAVAILABLE')
  })
  it('is_private 컬럼이 없는 행(마이그레이션 전)은 공개로 취급', async () => {
    const res = await createSupabaseAccessScopeResolver(client({
      projects: { data: [{ id: 'p-old' }], error: null },
    })).resolve('u1')
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-old'])
  })
})
