import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: null as null | { isSuperuser: boolean },
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
  from: vi.fn(() => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) })),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/authz', () => ({ getActorForView: async () => mocks.actor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: mocks.from }) }))
vi.mock('@/components/agent/AgentOpsView', () => ({ AgentOpsView: () => null }))

import AgentOpsPage from '@/app/(app)/agent-ops/page'

/** 어포던스(사이드바 링크)와 같은 판정 — 링크만 숨기고 페이지는 열려 있는 드리프트 방지 */
describe('/agent-ops 페이지 게이트', () => {
  beforeEach(() => { mocks.redirect.mockClear(); mocks.from.mockClear() })

  it('슈퍼유저가 아니면 /projects 로 보내고 프로젝트 목록을 조회하지 않는다', async () => {
    mocks.actor = { isSuperuser: false }
    await expect(AgentOpsPage()).rejects.toThrow('REDIRECT:/projects')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('actor 없음(비로그인·degraded)도 fail-closed', async () => {
    mocks.actor = null
    await expect(AgentOpsPage()).rejects.toThrow('REDIRECT:/projects')
  })

  it('슈퍼유저는 렌더된다', async () => {
    mocks.actor = { isSuperuser: true }
    await expect(AgentOpsPage()).resolves.toBeTruthy()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
