// tests/actions/agent-seatmap-refresh.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getActorForView: vi.fn(), getSeatmap: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: mocks.getSeatmap }))
import { refreshSeatmap } from '@/app/actions/agentSeatmap'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const MEMBER_P1 = { userId: 'u1', isSuperuser: false, projectRoles: new Map([[P1, 'member']]), rosterTeams: new Map(), teamCode: null, teamId: null }

beforeEach(() => { vi.clearAllMocks(); mocks.getActorForView.mockResolvedValue(MEMBER_P1); mocks.getSeatmap.mockResolvedValue({ floors: [] }) })

describe('refreshSeatmap — projectId', () => {
  it('내 프로젝트면 getSeatmap 에 { projectId } 옵션으로 넘긴다', async () => {
    const r = await refreshSeatmap('mine', P1)
    expect(r).toEqual({ ok: true, seatmap: { floors: [] } })
    expect(mocks.getSeatmap).toHaveBeenCalledWith(MEMBER_P1, expect.any(Number), 'mine', { projectId: P1 })
  })
  it('projectId 없으면 빈 옵션', async () => {
    await refreshSeatmap('all')
    expect(mocks.getSeatmap).toHaveBeenCalledWith(MEMBER_P1, expect.any(Number), 'all', {})
  })
  it('멤버가 아닌 프로젝트는 권한 없음 — 조회하지 않는다', async () => {
    expect(await refreshSeatmap('mine', P2)).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('UUID 형식이 아니면 프로젝트 값 오류 — 조회하지 않는다', async () => {
    expect(await refreshSeatmap('mine', 'p1')).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(await refreshSeatmap('mine', "' or 1=1" as string)).toEqual({ ok: false, error: '프로젝트 값이 잘못됐습니다.' })
    expect(mocks.getSeatmap).not.toHaveBeenCalled()
  })
  it('actor 없으면 권한 없음', async () => {
    mocks.getActorForView.mockResolvedValue(null)
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: false, error: '권한이 없습니다.' })
  })
  it('조회가 throw 하면 고정 문구로 실패', async () => {
    mocks.getSeatmap.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshSeatmap('mine', P1)).toEqual({ ok: false, error: '좌석표 재조회에 실패했습니다.' })
    spy.mockRestore()
  })
})
