// 로스터 명찰의 단계 이름표 — 머지 충돌(2026-09-23)이 raw 값으로 새지 않는다.
import { describe, expect, it } from 'vitest'
import { PHASE_KO } from '@/components/agents/RosterBoard'

describe('RosterBoard PHASE_KO', () => {
  it('merge_conflict 를 "머지 충돌" 로 읽는다', () => {
    expect(PHASE_KO.merge_conflict).toBe('머지 충돌')
    expect(PHASE_KO.blocked).toBe('결정 대기')
  })
})
