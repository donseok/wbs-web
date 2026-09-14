// tests/data/agent-seatmap-project.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/domain/authz'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { getProjectOffice, getSeatmap, seatmapFloorIds } from '@/lib/data/agentSeatmap'

const NOW = Date.parse('2026-09-14T09:00:00Z')
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록. tests/data/agent-seatmap.test.ts 의 헬퍼에 maybeSingle 과 auth 를 더한 것. */
function admin(queues: Record<string, Resp[]>, calls: Record<string, unknown[][]> = {}) {
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'eq', 'or', 'gte', 'gt', 'order', 'limit', 'maybeSingle']) {
        b[k] = (...a: unknown[]) => { (calls[`${table}.${k}`] ??= []).push(a); return b }
      }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'a@x.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}
const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', isSuperuser: false, projectRoles: new Map(), rosterTeams: new Map(), teamCode: null, teamId: null, ...over,
} as Actor)
const SUPER = actor({ isSuperuser: true })
const MEMBER_P1 = actor({ projectRoles: new Map([['p1', 'member' as const]]) })

beforeEach(() => { vi.clearAllMocks() })

describe('seatmapFloorIds', () => {
  it('projectId 없으면 seatmapProjectIds 그대로(슈퍼유저 null, 멤버는 역할 목록)', () => {
    expect(seatmapFloorIds(SUPER)).toBeNull()
    expect(seatmapFloorIds(MEMBER_P1)).toEqual(['p1'])
  })
  it('projectId 있으면 접근 범위와 교집합 — 슈퍼유저 [id], 멤버는 목록에 있을 때만 [id], 없으면 []', () => {
    expect(seatmapFloorIds(SUPER, 'p2')).toEqual(['p2'])
    expect(seatmapFloorIds(MEMBER_P1, 'p1')).toEqual(['p1'])
    expect(seatmapFloorIds(MEMBER_P1, 'p2')).toEqual([])
  })
})

describe('getSeatmap({ projectId })', () => {
  it('범위 밖 프로젝트면 조회 없이 빈 좌석표', async () => {
    const a = admin({})
    const map = await getSeatmap(MEMBER_P1, NOW, 'all', { projectId: 'p2' })
    expect(map.floors).toEqual([])
    expect(a.from).not.toHaveBeenCalled()
  })
  it('슈퍼유저 + projectId 면 주문 조회에 그 프로젝트 필터 하나만 건다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({ agent_work_orders: [{ data: [] }] }, calls)
    await getSeatmap(SUPER, NOW, 'all', { projectId: 'p1' })
    expect(calls['agent_work_orders.in']?.[0]).toEqual(['project_id', ['p1']])
  })
})

describe('getProjectOffice', () => {
  it('프로젝트 이름과 이 프로젝트 층 좌석표를 함께 돌려준다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({ projects: [{ data: { id: 'p1', name: 'mes-base' } }], agent_work_orders: [{ data: [] }] }, calls)
    const office = await getProjectOffice(MEMBER_P1, 'p1', NOW, 'all')
    expect(office.projectName).toBe('mes-base')
    expect(office.seatmap.floors).toEqual([])
    expect(calls['projects.eq']?.[0]).toEqual(['id', 'p1'])
    expect(calls['projects.maybeSingle']).toHaveLength(1)
  })
  it('프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다)', async () => {
    admin({ projects: [{ data: null }], agent_work_orders: [{ data: [] }] })
    const office = await getProjectOffice(SUPER, 'p9', NOW, 'all')
    expect(office.projectName).toBeNull()
  })
  it('프로젝트 조회가 error 면 throw', async () => {
    admin({ projects: [{ data: null, error: { message: 'boom' } }], agent_work_orders: [{ data: [] }] })
    await expect(getProjectOffice(SUPER, 'p1', NOW, 'all')).rejects.toThrow(/boom/)
  })
})
