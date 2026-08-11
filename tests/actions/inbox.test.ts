import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createServerClient: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { getInboxFeed, markInboxSeen } from '@/app/actions/inbox'

type Resp = { data?: unknown; error?: { message: string } | null }

function client(queues: Record<string, Resp[]>) {
  const updates: Record<string, unknown[]> = {}
  return {
    updates,
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gt']) b[k] = () => b
      b.update = (patch: unknown) => { (updates[table] ??= []).push(patch); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 'u1' })
})

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', seen_at: null, read_at: null, created_at: '2026-08-11T00:00:00Z',
  notification_events: {
    type: 'issue.assigned', category: 'issue',
    payload: { title: '이슈 A', detail: null, href: '/p/p1/issues' },
    created_at: '2026-08-11T00:00:00Z',
  },
  ...over,
})

describe('getInboxFeed', () => {
  it('수신 행을 InboxItem 으로 변환하고 unseen 을 센다', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      notification_recipients: [{ data: [row(), row({ id: 'r2', seen_at: '2026-08-11T01:00:00Z' })] }],
      user_preferences: [{ data: null }],
    }))
    const r = await getInboxFeed()
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ recipientId: 'r1', title: '이슈 A', seen: false, read: false })
    expect(r.unseen).toBe(1)
  })
  it('prefs 로 꺼진 타입은 피드·배지에서 제외', async () => {
    mocks.createServerClient.mockResolvedValue(client({
      notification_recipients: [{ data: [row()] }],
      user_preferences: [{ data: { prefs: { notif: { 'issue.assigned': false } } } }],
    }))
    const r = await getInboxFeed()
    expect(r.items).toHaveLength(0)
    expect(r.unseen).toBe(0)
  })
  it('조회 실패는 failed 로 표면화 — 빈 피드로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createServerClient.mockResolvedValue(client({
      notification_recipients: [{ data: null, error: { message: 'boom' } }],
    }))
    const r = await getInboxFeed()
    expect(r.failed).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('markInboxSeen', () => {
  it('본인 unseen 행 전체에 seen_at 을 쓴다 (admin 경유 — 쓰기 정책 0)', async () => {
    const c = client({ notification_recipients: [{ data: null }] })
    mocks.createAdminClient.mockReturnValue(c)
    const r = await markInboxSeen()
    expect(r.ok).toBe(true)
    expect(c.updates.notification_recipients).toHaveLength(1)
  })
  it('비로그인은 거부', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect(await markInboxSeen()).toEqual({ ok: false })
  })
})
