import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 게이트를 통과하기 전에는 service_role 클라이언트가 만들어지면 안 된다.
const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const getClaimsMock = vi.hoisted(() => vi.fn(async () => ({ data: null }) as unknown))
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => ({ from: () => ({ insert }) })),
}))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock } })),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { POST } from '@/app/api/track/route'

const PID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const req = (body: unknown) =>
  new Request('http://localhost/api/track', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  insert.mockClear()
  insert.mockResolvedValue({ error: null })
  createAdminClient.mockClear()
  getClaimsMock.mockReset()
  process.env.USAGE_TRACKING = 'on'
})
afterEach(() => { delete process.env.USAGE_TRACKING })

describe('수집 게이트', () => {
  it('수집이 꺼져 있으면 DB 에 접근하지 않는다', async () => {
    process.env.USAGE_TRACKING = 'off'
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: 'disabled' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('미인증이면 401 이고 DB 에 접근하지 않는다', async () => {
    getClaimsMock.mockResolvedValue({ data: null })
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each([
    ['path 없음', {}],
    ['path 가 문자열이 아님', { path: 42 }],
    ['슬래시로 시작하지 않음', { path: 'https://evil.example/x' }],
    ['너무 김', { path: '/' + 'a'.repeat(600) }],
  ])('잘못된 본문(%s)은 400 이고 DB 에 접근하지 않는다', async (_n, body) => {
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'u1' } } })
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('기록 내용 — 본문을 신뢰하지 않는다', () => {
  beforeEach(() => { getClaimsMock.mockResolvedValue({ data: { claims: { sub: 'real-user' } } }) })

  it('사용자 id 는 쿠키의 것을 쓰고 본문의 user_id 는 무시한다', async () => {
    const res = await POST(req({ path: '/minutes', user_id: 'spoofed', menu_key: 'spoofed' }))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'real-user',
      menu_key: 'minutes',
    }))
  })

  it('경로에서 메뉴 키·프로젝트 id 를 서버가 판정하고 UUID 를 정규화한다', async () => {
    await POST(req({ path: `/p/${PID}/wbs?view=gantt` }))
    expect(insert).toHaveBeenCalledWith({
      user_id: 'real-user',
      menu_key: 'wbs',
      path: '/p/:id/wbs',
      project_id: PID,
      event_name: 'page_view',
      metadata: {},
    })
  })

  it('Wiki 제품 이벤트만 Wiki 경로에 기록하고 질문 원문 같은 metadata는 버린다', async () => {
    const res = await POST(req({
      path: `/p/${PID}/wiki`,
      eventName: 'wiki_ask_answered',
      metadata: {
        result_count: 3,
        grounded: true,
        question_short: '짧은 민감 질문도 저장 금지',
        question: '민감한 질문 원문'.repeat(20),
        nested: { body: '저장 금지' },
      },
    }))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'wiki_ask_answered',
      metadata: { result_count: 3, grounded: true },
    }))
  })

  it('0079 전 스키마에서는 page view를 기존 행 형식으로 다시 기록한다', async () => {
    insert
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'event_name' column" } } as never)
      .mockResolvedValueOnce({ error: null })

    const res = await POST(req({ path: `/p/${PID}/wiki` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, compatibility: 'legacy' })
    expect(insert).toHaveBeenNthCalledWith(2, {
      user_id: 'real-user',
      menu_key: 'wiki',
      path: '/p/:id/wiki',
      project_id: PID,
    })
  })

  it('0079 전 스키마에서 Wiki 제품 이벤트를 page view로 오염시키지 않고 건너뛴다', async () => {
    insert.mockResolvedValueOnce({
      error: { code: '42703', message: 'column metadata does not exist' },
    } as never)

    const res = await POST(req({ path: `/p/${PID}/wiki`, eventName: 'wiki_search' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'schema_missing' })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('알 수 없는 이벤트와 Wiki 밖의 Wiki 이벤트는 거절한다', async () => {
    const unknown = await POST(req({ path: `/p/${PID}/wiki`, eventName: 'wiki_raw_prompt' }))
    expect(unknown.status).toBe(400)
    const wrongPath = await POST(req({ path: `/p/${PID}/wbs`, eventName: 'wiki_search' }))
    expect(wrongPath.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('insert 실패는 삼키지 않고 500 으로 올린다', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'boom' } } as never)
    const res = await POST(req({ path: '/minutes' }))
    expect(res.status).toBe(500)
  })
})
