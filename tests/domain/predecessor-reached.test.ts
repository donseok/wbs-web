// 선행 충족 세 축(스펙 2026-09-15 §3.7)과 사람 단계 지정 잠금(§3.5) — 여러 소비처가 같은 판정을 쓰도록 도메인에 둔다.
import { describe, expect, it } from 'vitest'
import { AGENT_HELD_ORDER_STATUSES, REACHED_STAGES, STAGE_ORDER, predecessorReached, stageLockedForHuman } from '@/lib/domain/agentWork'

describe('predecessorReached — 선행 충족 세 축', () => {
  it('면제된 간선(waived)은 다른 축과 무관하게 충족이다(강제 진행 F2)', () => {
    expect(predecessorReached({ stage: null, waived: true })).toBe(true)
    expect(predecessorReached({ stage: 'ip', orderApproved: false, actualPct: 10, waived: true })).toBe(true)
    expect(predecessorReached({ stage: 'ip', waived: false })).toBe(false)
  })
  it('stage im·xx', () => {
    expect(predecessorReached({ stage: 'im' })).toBe(true)
    expect(predecessorReached({ stage: 'xx' })).toBe(true)
    expect(predecessorReached({ stage: 'ip' })).toBe(false)
    expect(predecessorReached({ stage: null })).toBe(false)
  })
  it('승인된 주문', () => {
    expect(predecessorReached({ stage: null, orderApproved: true })).toBe(true)
  })
  it('실적 100 — 위임하지 않은 사람 Task', () => {
    expect(predecessorReached({ stage: null, actualPct: 100 })).toBe(true)
    expect(predecessorReached({ stage: null, actualPct: 99.6 })).toBe(false)
    expect(predecessorReached({ stage: null, actualPct: null })).toBe(false)
  })
  it('fp 는 어휘에 없다', () => {
    expect([...STAGE_ORDER]).toEqual(['as', 'ip', 'im', 'xx'])
    expect(REACHED_STAGES.has('fp')).toBe(false)
  })
})

describe('stageLockedForHuman — 사람 단계 지정·실적 100 잠금', () => {
  it('에이전트가 쥔 주문 status 는 claimed·reported 뿐 — ready 는 dev_workflow 리프마다 상주한다', () => {
    expect([...AGENT_HELD_ORDER_STATUSES]).toEqual(['claimed', 'reported'])
  })
  it('위임됐으면 주문 status 와 무관하게 잠긴다', () => {
    expect(stageLockedForHuman({ delegated: true, orderStatus: null })).toBe(true)
    expect(stageLockedForHuman({ delegated: true, orderStatus: 'ready' })).toBe(true)
  })
  it('위임이 없으면 claimed·reported 만 잠근다', () => {
    expect(stageLockedForHuman({ delegated: false, orderStatus: 'ready' })).toBe(false)
    expect(stageLockedForHuman({ delegated: false, orderStatus: 'approved' })).toBe(false)
    expect(stageLockedForHuman({ delegated: false, orderStatus: null })).toBe(false)
    expect(stageLockedForHuman({ delegated: false, orderStatus: 'claimed' })).toBe(true)
    expect(stageLockedForHuman({ delegated: false, orderStatus: 'reported' })).toBe(true)
  })
})
