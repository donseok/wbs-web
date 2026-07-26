import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runWikiWorkerOnce: vi.fn(),
}))

vi.mock('@/lib/ai/wiki-ingest', () => ({
  runWikiWorkerOnce: mocks.runWikiWorkerOnce,
}))

import { GET, POST } from '@/app/api/wiki/worker/route'

const CRON_SECRET = 'vercel-cron-secret'
const MANUAL_SECRET = 'manual-worker-secret'
const RESULT = {
  claimed: 2,
  completed: 1,
  skipped: 1,
  failed: 0,
}

function getRequest(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/wiki/worker', {
    method: 'GET',
    headers: authorization ? { authorization } : undefined,
  })
}

function postRequest(
  body: unknown = {},
  secret?: string,
): NextRequest {
  return new NextRequest('http://localhost/api/wiki/worker', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-cron-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('/api/wiki/worker 보호 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('WIKI_WORKER_ENABLED', 'true')
    vi.stubEnv('CRON_SECRET', CRON_SECRET)
    vi.stubEnv('WIKI_WORKER_SECRET', MANUAL_SECRET)
    mocks.runWikiWorkerOnce.mockResolvedValue(RESULT)
  })

  it('GET은 worker flag 또는 CRON_SECRET이 없으면 존재를 404로 숨긴다', async () => {
    vi.stubEnv('WIKI_WORKER_ENABLED', 'false')
    const disabled = await GET(getRequest(`Bearer ${CRON_SECRET}`))
    expect(disabled.status).toBe(404)

    vi.stubEnv('WIKI_WORKER_ENABLED', 'true')
    vi.stubEnv('CRON_SECRET', '')
    const unconfigured = await GET(getRequest(`Bearer ${CRON_SECRET}`))
    expect(unconfigured.status).toBe(404)
    expect(mocks.runWikiWorkerOnce).not.toHaveBeenCalled()
  })

  it('GET은 정확한 CRON_SECRET Bearer 인증만 허용한다', async () => {
    for (const authorization of [
      undefined,
      CRON_SECRET,
      `Basic ${CRON_SECRET}`,
      `Bearer ${MANUAL_SECRET}`,
      'Bearer wrong-secret',
    ]) {
      const response = await GET(getRequest(authorization))
      expect(response.status).toBe(403)
    }
    expect(mocks.runWikiWorkerOnce).not.toHaveBeenCalled()
  })

  it('GET은 인증 성공 시 고정 배치 10으로 worker를 한 번 실행한다', async () => {
    const response = await GET(getRequest(`Bearer ${CRON_SECRET}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(RESULT)
    expect(mocks.runWikiWorkerOnce).toHaveBeenCalledTimes(1)
    expect(mocks.runWikiWorkerOnce).toHaveBeenCalledWith(10)
  })

  it('POST는 기존 WIKI_WORKER_SECRET x-cron-secret 인증을 유지한다', async () => {
    const missing = await POST(postRequest({ limit: 7 }))
    expect(missing.status).toBe(403)

    // GET용 CRON_SECRET은 수동 POST 인증에 재사용할 수 없다.
    const cronSecret = await POST(postRequest({ limit: 7 }, CRON_SECRET))
    expect(cronSecret.status).toBe(403)
    expect(mocks.runWikiWorkerOnce).not.toHaveBeenCalled()

    const response = await POST(postRequest({ limit: 7 }, MANUAL_SECRET))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(RESULT)
    expect(mocks.runWikiWorkerOnce).toHaveBeenCalledTimes(1)
    expect(mocks.runWikiWorkerOnce).toHaveBeenCalledWith(7)
  })

  it('POST는 기본 limit 5와 1~20 정수 검증을 유지한다', async () => {
    const defaultResponse = await POST(postRequest({}, MANUAL_SECRET))
    expect(defaultResponse.status).toBe(200)
    expect(mocks.runWikiWorkerOnce).toHaveBeenCalledWith(5)

    for (const limit of [0, 21, 1.5, '5']) {
      const response = await POST(postRequest({ limit }, MANUAL_SECRET))
      expect(response.status).toBe(400)
    }
    expect(mocks.runWikiWorkerOnce).toHaveBeenCalledTimes(1)
  })
})
