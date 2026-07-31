import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'

const SECRET = 'test-agent-secret'
// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const O_MISSING = '99999999-9999-4999-8999-999999999999'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (url: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${SECRET}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('GET /api/v1/agent/work', () => {
  it('게이트 닫힘 404', async () => {
    process.env.AGENT_API_ENABLED = 'false'
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
  })
  it('미등록 프로젝트 404 — D-CUBE 은닉의 근거', async () => {
    useAdmin({ agent_projects: [{ data: null }] })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
  })
  it('project_id 누락 400', async () => {
    useAdmin({})
    const res = await listGET(get('http://l/api/v1/agent/work'))
    expect(res.status).toBe(400)
  })
  it('project_id 비형식 400 — UUID 검증 실패', async () => {
    useAdmin({})
    const res = await listGET(get('http://l/api/v1/agent/work?project_id=invalid-id'))
    expect(res.status).toBe(400)
  })
  it('ready 목록 + 항목 컨텍스트 join', async () => {
    useAdmin({
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_orders: [{ data: [
        { id: O1, status: 'ready', priority: 1, instructions: '지시', claimed_by: null, claimed_at: null, wbs_item_id: W1 },
      ] }],
      wbs_items: [{ data: [
        { id: W1, code: '1.2.3', name: '로그인 화면', biz: '설명', deliverable: '화면', planned_start: null, planned_end: null },
      ] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders[0].item.name).toBe('로그인 화면')
  })
  it('주문 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    useAdmin({
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_orders: [{ data: null, error: { message: 'db down' } }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(500)
  })
})

describe('GET /api/v1/agent/work/[id]', () => {
  it('주문 + 보고 이력 반환', async () => {
    useAdmin({
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '', claimed_by: 'cli', claimed_at: null, wbs_item_id: W1 } }],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_reports: [{ data: [{ id: 'r1', kind: 'completion', percent: 100, summary: 'done', links: [], agent: 'cli', review_action: null, review_note: null, created_at: 'x' }] }],
      wbs_items: [{ data: [{ id: W1, code: '1', name: 'n', biz: null, deliverable: null, planned_start: null, planned_end: null }] }],
    })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O1}`), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reports).toHaveLength(1)
    expect(body.order.project_id).toBeUndefined()
  })
  it('없는 주문 404 — 유효 형식 UUID 사용', async () => {
    useAdmin({ agent_work_orders: [{ data: null }] })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O_MISSING}`), { params: Promise.resolve({ id: O_MISSING }) })
    expect(res.status).toBe(404)
  })
  it('id 비형식 400 — UUID 검증 실패', async () => {
    useAdmin({})
    const res = await detailGET(get('http://l/api/v1/agent/work/invalid-id'), { params: Promise.resolve({ id: 'invalid-id' }) })
    expect(res.status).toBe(400)
  })
})
