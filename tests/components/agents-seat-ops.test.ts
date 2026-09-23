// tests/components/agents-seat-ops.test.ts
// 좌석 결재 표 — 어느 상태에서 어떤 op 가 뜨고 누가 누를 수 있는지. 자격은 서버 로더와 같은 축이어야 한다:
//   approve · stop → 관리자 또는 서브트리 관리자(loadOrderForAdmin, stop 분기)
//   reject · unapprove · rework → +리프 담당자 본인(loadOrderForReview)
import { describe, it, expect } from 'vitest'
import type { SeatState } from '@/lib/domain/seatState'
import { mayRun, opSpec, opsFor, ERR_NO_RIGHT, ERR_NO_RIGHT_REVIEW, RESUME_PENDING } from '@/components/agents/seatOps'

const who = (canManage: boolean, assigneeMine: boolean) => ({ canManage, assigneeMine })
const kinds = (state: SeatState, canManage = true, assigneeMine = false) =>
  opsFor({ state, ...who(canManage, assigneeMine) }).map(o => o.spec.kind)

describe('opsFor — 상태마다 다른 op', () => {
  it('승인 대기는 승인·반려, 머지 완료는 승인 취소·재작업 요청', () => {
    expect(kinds('WAIT')).toEqual(['approve', 'reject'])
    expect(kinds('DONE')).toEqual(['unapprove', 'rework'])
  })
  it('살아 있는 점유는 중단 하나뿐 — 되살릴 것이 없다', () => {
    // BLOCKED·REJECTED 의 러너는 죽은 게 아니라 사람의 답을 기다리는 중이다.
    for (const s of ['ACTIVE', 'BLOCKED', 'REJECTED'] as SeatState[]) {
      expect(kinds(s)).toEqual(['stop'])
    }
  })
  it('멈춘 두 상태에만 「이어서 시작」이 앞에 붙는다', () => {
    for (const s of ['STALE', 'OFFLINE'] as SeatState[]) {
      expect(kinds(s)).toEqual(['resume', 'stop'])
    }
  })
  it('스텁 잔존이면 승인은 자격이 있어도 잠기고 그 문구가 이유다(강제 진행 F6)', () => {
    const ops = opsFor({ state: 'WAIT', ...who(true, false), stubPending: [{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }] })
    expect(ops.find(o => o.spec.kind === 'approve')).toEqual(expect.objectContaining({ allowed: false, why: '스텁 잔존: TSK-01 대체' }))
    expect(ops.find(o => o.spec.kind === 'reject')!.allowed).toBe(true)
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
  it('담당자 본인은 반려·승인 취소·재작업만 되고 승인·중단은 안 된다', () => {
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
    expect(mayRun(who(true, false), opSpec('stop'))).toBe(true)
    expect(mayRun(who(false, false), opSpec('reject'))).toBe(false)
  })
})

describe('재개 요청 — 한 번 걸리면 다시 누를 수 없다', () => {
  const stale = (canManage: boolean, resumeRequestedAt: string | null) =>
    opsFor({ state: 'STALE', ...who(canManage, false), resumeRequestedAt })

  it('요청이 없으면 관리자는 누를 수 있다', () => {
    const op = stale(true, null).find(o => o.spec.kind === 'resume')!
    expect(op.allowed).toBe(true)
    expect(op.why).toBe(opSpec('resume').title)
  })
  it('이미 요청이 걸렸으면 잠기고 대기 중이라고 말한다', () => {
    const op = stale(true, '2026-09-18T00:00:00.000Z').find(o => o.spec.kind === 'resume')!
    expect(op.allowed).toBe(false)
    expect(op.why).toBe(RESUME_PENDING)
  })
  it('요청이 걸려도 중단은 그대로 열려 있다 — 포기하는 길은 막지 않는다', () => {
    const rel = stale(true, '2026-09-18T00:00:00.000Z').find(o => o.spec.kind === 'stop')!
    expect(rel.allowed).toBe(true)
  })
  it('담당자 본인은 재개를 요청하지 못한다 — 중단과 같은 축이다', () => {
    expect(mayRun(who(false, true), opSpec('resume'))).toBe(false)
    expect(opsFor({ state: 'STALE', ...who(false, true) }).find(o => o.spec.kind === 'resume')!.why).toBe(ERR_NO_RIGHT)
  })
})

describe('중단 — 되돌리기 어려워 한 번 확인한다(2026-09-19)', () => {
  it('라벨은 「중단」, 확인이 필요한 op 는 중단 하나뿐이다', () => {
    expect(opSpec('stop').label).toBe('중단')
    expect(opSpec('stop').needsConfirm).toBe(true)
    expect(opSpec('stop').needsNote).toBe(false)
    for (const k of ['approve', 'reject', 'unapprove', 'rework', 'resume'] as const) expect(opSpec(k).needsConfirm).toBe(false)
  })
  it('설명은 위임 해제·단계 as·워커 정지를 말한다', () => {
    const t = opSpec('stop').title
    expect(t).toContain('에이전트 위임을 끄고')
    expect(t).toContain('착수 전(as)')
    expect(t).toContain('워커는 다음 신호(약 1분 안)에서 멈춥니다')
  })
})

describe('사유 — 서버가 비면 거부하는 op', () => {
  it('반려와 재작업 요청만 사유를 요구한다', () => {
    expect(opSpec('reject').needsNote).toBe(true)
    expect(opSpec('rework').needsNote).toBe(true)
    for (const k of ['approve', 'unapprove', 'stop', 'resume'] as const) expect(opSpec(k).needsNote).toBe(false)
  })
  it('자격이 있어도 사유가 필요한 op 는 그 사실이 표에 남아 있다', () => {
    const reject = opsFor({ state: 'WAIT', ...who(true, false) }).find(o => o.spec.kind === 'reject')!
    expect(reject.spec.needsNote).toBe(true)
    expect(reject.why).toContain('에이전트가 사유를 읽고')
  })
})
