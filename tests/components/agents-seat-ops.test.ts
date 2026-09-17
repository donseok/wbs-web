// tests/components/agents-seat-ops.test.ts
// 좌석 결재 표 — 어느 상태에서 어떤 op 가 뜨고 누가 누를 수 있는지. 자격은 서버 로더와 같은 축이어야 한다:
//   approve · release → 관리자 또는 서브트리 관리자(loadOrderForAdmin, release 분기)
//   reject · unapprove · rework → +리프 담당자 본인(loadOrderForReview)
import { describe, it, expect } from 'vitest'
import type { SeatState } from '@/lib/domain/seatState'
import { mayRun, opSpec, opsFor, ERR_NO_RIGHT, ERR_NO_RIGHT_REVIEW } from '@/components/agents/seatOps'

const who = (canManage: boolean, assigneeMine: boolean) => ({ canManage, assigneeMine })
const kinds = (state: SeatState, canManage = true, assigneeMine = false) =>
  opsFor({ state, ...who(canManage, assigneeMine) }).map(o => o.spec.kind)

describe('opsFor — 상태마다 다른 op', () => {
  it('승인 대기는 승인·반려, 머지 완료는 승인 취소·재작업 요청', () => {
    expect(kinds('WAIT')).toEqual(['approve', 'reject'])
    expect(kinds('DONE')).toEqual(['unapprove', 'rework'])
  })
  it('점유 중인 다섯 상태는 회수 하나뿐', () => {
    for (const s of ['ACTIVE', 'STALE', 'OFFLINE', 'BLOCKED', 'REJECTED'] as SeatState[]) {
      expect(kinds(s)).toEqual(['release'])
    }
  })
  it('빈자리에는 아무 것도 없다', () => {
    expect(kinds('READY')).toEqual([])
  })
})

describe('자격 — 서버 가드와 같은 축', () => {
  it('관리자·서브트리 관리자는 다 할 수 있다', () => {
    for (const o of opsFor({ state: 'WAIT', ...who(true, false) })) expect(o.allowed).toBe(true)
    for (const o of opsFor({ state: 'DONE', ...who(true, false) })) expect(o.allowed).toBe(true)
    expect(opsFor({ state: 'ACTIVE', ...who(true, false) })[0].allowed).toBe(true)
  })
  it('담당자 본인은 반려·승인 취소·재작업만 되고 승인·회수는 안 된다', () => {
    const wait = opsFor({ state: 'WAIT', ...who(false, true) })
    expect(wait.find(o => o.spec.kind === 'approve')!.allowed).toBe(false)
    expect(wait.find(o => o.spec.kind === 'reject')!.allowed).toBe(true)
    for (const o of opsFor({ state: 'DONE', ...who(false, true) })) expect(o.allowed).toBe(true)
    expect(opsFor({ state: 'ACTIVE', ...who(false, true) })[0].allowed).toBe(false)
  })
  it('둘 다 아니면 전부 잠기고 거부 사유가 op 마다 다르다', () => {
    const wait = opsFor({ state: 'WAIT', ...who(false, false) })
    expect(wait.every(o => !o.allowed)).toBe(true)
    expect(wait.find(o => o.spec.kind === 'approve')!.why).toBe(ERR_NO_RIGHT)
    expect(wait.find(o => o.spec.kind === 'reject')!.why).toBe(ERR_NO_RIGHT_REVIEW)
  })
  it('mayRun 은 자격 판정의 정본이다', () => {
    expect(mayRun(who(false, true), opSpec('approve'))).toBe(false)
    expect(mayRun(who(false, true), opSpec('rework'))).toBe(true)
    expect(mayRun(who(true, false), opSpec('release'))).toBe(true)
    expect(mayRun(who(false, false), opSpec('reject'))).toBe(false)
  })
})

describe('사유 — 서버가 비면 거부하는 op', () => {
  it('반려와 재작업 요청만 사유를 요구한다', () => {
    expect(opSpec('reject').needsNote).toBe(true)
    expect(opSpec('rework').needsNote).toBe(true)
    for (const k of ['approve', 'unapprove', 'release'] as const) expect(opSpec(k).needsNote).toBe(false)
  })
  it('자격이 있어도 사유가 필요한 op 는 그 사실이 표에 남아 있다', () => {
    const reject = opsFor({ state: 'WAIT', ...who(true, false) }).find(o => o.spec.kind === 'reject')!
    expect(reject.spec.needsNote).toBe(true)
    expect(reject.why).toContain('에이전트가 사유를 읽고')
  })
})
