// 셸 응답의 확인 필요 결정 수(과제 C, 스펙 §7.4·§10) — 배지 하나 때문에 셸을 죽이지 않되 0 으로 위장하지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const pa = vi.fn()
vi.mock('@/app/actions/inbox', () => ({ getInboxFeed: async () => ({ items: [], unseen: 0 }) }))
vi.mock('@/app/actions/notifications', () => ({ getNotifications: async () => null }))
vi.mock('@/app/actions/announcements', () => ({ getHeaderAnnouncements: async () => [], getUnreadAnnouncementCount: async () => 0 }))
vi.mock('@/lib/data/agentApprovals', () => ({ getPendingApprovals: (...a: unknown[]) => pa(...(a as [])) }))

import { GET } from '@/app/api/shell/route'

const MENU = '11111111-1111-4111-8111-111111111111'
const get = (qs: string) => GET(new NextRequest(`http://l/api/shell${qs}`))

beforeEach(() => { pa.mockReset() })

describe('GET /api/shell — 결재 대기와 결정 수', () => {
  it('메뉴 프로젝트의 수·결정 수·partial 을 싣는다', async () => {
    pa.mockResolvedValue({ count: 3, decisions: 2, decisionsPartial: true })
    const j = await (await get(`?menu=${MENU}`)).json()
    expect(j).toMatchObject({ pendingApprovals: 3, pendingDecisions: 2, pendingDecisionsPartial: true })
    expect(pa).toHaveBeenCalledWith(MENU)
  })
  it('조회가 통째로 실패하면 건수 0·결정 수 null — 셸은 살린다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pa.mockRejectedValue(new Error('boom'))
    const res = await get(`?menu=${MENU}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pendingApprovals: 0, pendingDecisions: null, pendingDecisionsPartial: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('메뉴 문맥이 없으면 부르지 않고 0', async () => {
    const j = await (await get('')).json()
    expect(j).toMatchObject({ pendingApprovals: 0, pendingDecisions: 0, pendingDecisionsPartial: false })
    expect(pa).not.toHaveBeenCalled()
  })
})
