import { describe, expect, it } from 'vitest'
import type { Level } from '@/lib/domain/types'

describe('Level 타입 넓히기 (스펙 §4.3)', () => {
  it('임의 문자열이 Level 에 대입 가능해야 한다 — 컴파일 게이트', () => {
    const custom: Level = '설계'   // 3값 유니언이면 여기서 tsc 가 실패한다
    expect(typeof custom).toBe('string')
  })
})
