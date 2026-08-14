import { describe, expect, it } from 'vitest'
import { decideSearchAccess } from '@/lib/domain/searchAccess'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('decideSearchAccess', () => {
  it('허용 목록에 있으면 그 프로젝트 하나만 통과시킨다', () => {
    expect(decideSearchAccess(A, { ok: true, scope: { allowedProjectIds: [A, B] } }))
      .toEqual({ ok: true, projectIds: [A] })
  })

  it('허용 목록에 없으면 403 — 비공개 프로젝트 유출 경로를 막는다', () => {
    const r = decideSearchAccess(B, { ok: true, scope: { allowedProjectIds: [A] } })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ status: 403 })
  })

  it('허용 목록이 비면 403 — 빈 목록을 전체 허용으로 읽지 않는다', () => {
    expect(decideSearchAccess(A, { ok: true, scope: { allowedProjectIds: [] } }))
      .toMatchObject({ ok: false, status: 403 })
  })

  it('스코프 조회 자체가 실패하면 503 — 모르면 닫는다(fail-closed)', () => {
    expect(decideSearchAccess(A, { ok: false }))
      .toMatchObject({ ok: false, status: 503 })
  })

  it('요청 projectId 가 빈 문자열이면 403', () => {
    expect(decideSearchAccess('', { ok: true, scope: { allowedProjectIds: [A] } }))
      .toMatchObject({ ok: false, status: 403 })
  })
})
