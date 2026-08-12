import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET } from '@/app/api/cron/inbox-retention/route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
})

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/inbox-retention', { headers: auth ? { authorization: auth } : {} })

describe('inbox retention cron', () => {
  it('시크릿 불일치는 401 — fail-closed', async () => {
    expect((await GET(req('Bearer wrong'))).status).toBe(401)
    expect((await GET(req())).status).toBe(401)
  })
  it('CRON_SECRET 미설정이면 503 — 조용히 전삭제하지 않는다', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer anything'))).status).toBe(503)
  })
  it('정상 호출은 purge RPC 실행', async () => {
    const rpc = vi.fn(async () => ({ data: [{ recipients_deleted: 3, events_deleted: 1 }], error: null }))
    mocks.createAdminClient.mockReturnValue({ rpc })
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('purge_read_notifications', { retention_days: 90 })
  })
  it('RPC 실패는 500 로 표면화', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.createAdminClient.mockReturnValue({ rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) })
    expect((await GET(req('Bearer test-secret'))).status).toBe(500)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
