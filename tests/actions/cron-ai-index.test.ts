import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runIndexWorkerOnce: vi.fn(),
  // 라우트가 admin.from('projects').select('id') 를 부르므로 빈 객체를 주면 TypeError 로 죽는다.
  // 반환 타입을 성공/실패 유니온으로 넓혀 둔다 — 503 테스트가 error 형태를 mockReturnValue 로 넣는다.
  createAdminClient: vi.fn(() => ({
    from: () => ({ select: () => ({
      limit: async (): Promise<{ data: Array<{ id: string }> | null; error: { code: string; message: string } | null }> =>
        ({ data: [{ id: 'p1' }], error: null }),
    }) }),
  })),
}))
vi.mock('@/lib/ai/index/worker', () => ({ runIndexWorkerOnce: mocks.runIndexWorkerOnce }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET } from '@/app/api/cron/ai-index/route'

function request(auth?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/ai-index', {
    headers: auth ? { Authorization: auth } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'topsecret')
  vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
  mocks.runIndexWorkerOnce.mockResolvedValue({ claimed: 3, succeeded: 3, failed: 0 })
})

describe('GET /api/cron/ai-index', () => {
  it('Bearer 가 맞으면 워커를 한 번 돌린다', async () => {
    const res = await GET(request('Bearer topsecret'))
    expect(res.status).toBe(200)
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledOnce()
  })

  it('Bearer 가 틀리면 401 이고 워커를 부르지 않는다', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('헤더가 없으면 401', async () => {
    expect((await GET(request())).status).toBe(401)
  })

  it('CRON_SECRET 이 미설정이면 존재를 숨긴다(404)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer topsecret'))).status).toBe(404)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('워커 플래그가 꺼져 있으면 404', async () => {
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'false')
    expect((await GET(request('Bearer topsecret'))).status).toBe(404)
  })

  it('프로젝트 조회가 실패하면 503 — 빈 스코프로 위장하지 않는다', async () => {
    mocks.createAdminClient.mockReturnValue({
      from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code: 'ERR', message: 'boom' } }) }) }),
    })
    expect((await GET(request('Bearer topsecret'))).status).toBe(503)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })
})
