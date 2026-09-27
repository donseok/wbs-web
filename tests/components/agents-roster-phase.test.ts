// 로스터 명찰의 단계 이름표 — 머지 충돌(2026-09-23)이 raw 값으로 새지 않는다.
import { describe, expect, it } from 'vitest'
import { PHASE_KO, profilePhaseLabel } from '@/components/agents/RosterBoard'

describe('RosterBoard PHASE_KO', () => {
  it('merge_conflict 를 "머지 충돌" 로 읽는다', () => {
    expect(PHASE_KO.merge_conflict).toBe('머지 충돌')
    expect(PHASE_KO.blocked).toBe('결정 대기')
  })
  it('prepare 를 "준비" 로 읽는다(2026-09-24)', () => {
    expect(PHASE_KO.prepare).toBe('준비')
  })
})

// 프로필 카드 「진척 N% · 단계 …」 — 착수 직후(heartbeat 없음)는 비우지 않고 준비로, 보고된 단계는 한국어로.
describe('RosterBoard profilePhaseLabel', () => {
  it('heartbeat 가 없는 착수 좌석(phase=prepare)은 「준비」', () => {
    expect(profilePhaseLabel({ heartbeatPhase: null, phase: 'prepare' })).toBe('준비')
  })
  it('heartbeat 단계가 있으면 그 단계의 한국어 이름', () => {
    expect(profilePhaseLabel({ heartbeatPhase: 'build', phase: 'build' })).toBe('구현')
    expect(profilePhaseLabel({ heartbeatPhase: 'prepare', phase: 'prepare' })).toBe('준비')
  })
  it('heartbeat 단계가 없고 추정 단계만 있는 좌석(승인 대기·완료)은 종전대로 비운다', () => {
    expect(profilePhaseLabel({ heartbeatPhase: null, phase: 'refactor' })).toBeNull()
  })
  it('사전에 없는 값은 raw 로 보인다(조용히 삼키지 않는다)', () => {
    expect(profilePhaseLabel({ heartbeatPhase: 'weird', phase: 'prepare' })).toBe('weird')
  })
  it('설계 검토 대기는 설계 상태가 review 일 때만 — 「설계 승인」 뒤 남은 phase wait_review 만으로는 말하지 않는다(설계 상태 스펙 8절)', () => {
    expect(profilePhaseLabel({ heartbeatPhase: 'wait_review', phase: 'wait_review', reviewWait: true })).toBe('설계 검토 대기')
    expect(profilePhaseLabel({ heartbeatPhase: 'wait_review', phase: 'wait_review', reviewWait: false })).toBeNull()
    expect(profilePhaseLabel({ heartbeatPhase: 'wait_review', phase: 'wait_review' })).toBeNull()
    // 그 밖의 단계는 지금 규칙 그대로다.
    expect(profilePhaseLabel({ heartbeatPhase: 'build', phase: 'build', reviewWait: false })).toBe('구현')
  })
})
