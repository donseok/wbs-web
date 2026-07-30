import { describe, it, expect } from 'vitest'

// 운영 스크립트의 판정 로직만 순수 함수로 떼어 검사한다. 2026-07-30 사고에서
// 재구축 잡이 나흘간 status='running' 으로 멈춰 있었는데 아무 화면·로그·스크립트도
// 그 사실을 말해주지 않았다. 이 판정이 그 침묵을 깨는 유일한 지점이므로 테스트로 박는다.
import {
  classifyRebuildHealth,
  LEASE_SECONDS,
  summarizeTopicGranularity,
} from '../../scripts/wiki-health.mjs'

const NOW = new Date('2026-07-30T02:00:00Z')

const job = (over: Record<string, unknown> = {}) => ({
  status: 'done',
  generation: 35,
  reset_generation: 35,
  attempts: 0,
  max_attempts: 5,
  locked_at: null,
  last_error: null,
  cursor_observed_sort: '2026-07-29 02:18:00',
  ...over,
})

describe('classifyRebuildHealth', () => {
  it('done 이고 남은 회의록이 없으면 정상', () => {
    const r = classifyRebuildHealth(job(), { remaining: 0, now: NOW })
    expect(r.level).toBe('ok')
    expect(r.stalled).toBe(false)
  })

  it('lease 를 넘긴 running 은 멈춘 것으로 판정한다', () => {
    const lockedAt = new Date(NOW.getTime() - (LEASE_SECONDS + 60) * 1000).toISOString()
    const r = classifyRebuildHealth(
      job({ status: 'running', locked_at: lockedAt }),
      { remaining: 30, now: NOW },
    )
    expect(r.stalled).toBe(true)
    expect(r.level).toBe('fail')
    expect(r.reason).toMatch(/lease/i)
  })

  it('lease 안의 running 은 정상 진행으로 본다', () => {
    const lockedAt = new Date(NOW.getTime() - 60 * 1000).toISOString()
    const r = classifyRebuildHealth(
      job({ status: 'running', locked_at: lockedAt }),
      { remaining: 30, now: NOW },
    )
    expect(r.stalled).toBe(false)
    expect(r.level).toBe('progress')
  })

  it('dead_letter 는 무조건 실패', () => {
    const r = classifyRebuildHealth(
      job({ status: 'dead_letter', last_error: 'WIKI_ATOMIC_APPLY' }),
      { remaining: 5, now: NOW },
    )
    expect(r.level).toBe('fail')
    expect(r.stalled).toBe(true)
  })

  it('done 인데 남은 회의록이 있으면 실패 — 조용히 덜 반영된 상태다', () => {
    const r = classifyRebuildHealth(job(), { remaining: 12, now: NOW })
    expect(r.level).toBe('fail')
    expect(r.reason).toMatch(/12/)
  })

  it('reset_generation 이 generation 을 못 따라가면 리셋 대기로 경고한다', () => {
    const r = classifyRebuildHealth(
      job({ status: 'pending', generation: 36, reset_generation: 35 }),
      { remaining: 42, now: NOW },
    )
    expect(r.level).toBe('warn')
    expect(r.reason).toMatch(/리셋/)
  })

  it('attempts 가 max 에 닿으면 실패로 올린다', () => {
    const r = classifyRebuildHealth(
      job({ status: 'pending', attempts: 5, max_attempts: 5, last_error: 'WIKI_ATOMIC_APPLY' }),
      { remaining: 3, now: NOW },
    )
    expect(r.level).toBe('fail')
  })

  it('잡이 아예 없으면 판정 불가를 unknown 으로 표시한다 — 정상으로 위장하지 않는다', () => {
    const r = classifyRebuildHealth(null, { remaining: 0, now: NOW })
    expect(r.level).toBe('unknown')
    expect(r.stalled).toBe(false)
  })

  it('pending 이고 남은 게 있으면 진행 중 — 다음 cron/러너가 집어간다', () => {
    const r = classifyRebuildHealth(
      job({ status: 'pending' }),
      { remaining: 7, now: NOW },
    )
    expect(r.level).toBe('progress')
    expect(r.stalled).toBe(false)
  })
})

describe('summarizeTopicGranularity', () => {
  const mk = (spec: Record<string, number>) =>
    Object.entries(spec).flatMap(([title, n]) =>
      Array.from({ length: n }, () => ({ topicId: title, topicTitle: title })))

  it('최대 주제와 그 크기를 찾는다 — 판정 1의 핵심 지표', () => {
    const r = summarizeTopicGranularity(mk({ '데이터 관리': 68, '작은 주제': 3 }))
    expect(r.maxSize).toBe(68)
    expect(r.maxTitle).toBe('데이터 관리')
  })

  it('20건 이상 주제와 상한(15) 초과 주제를 따로 센다', () => {
    const r = summarizeTopicGranularity(mk({ a: 25, b: 20, c: 15, d: 14 }))
    expect(r.over20).toBe(2)          // a, b
    expect(r.saturated).toBe(3)       // a, b, c
    expect(r.saturatedItems).toBe(60) // 25+20+15
  })

  it('1항목 주제와 전체 주제 수를 센다', () => {
    const r = summarizeTopicGranularity(mk({ a: 1, b: 1, c: 5 }))
    expect(r.oneItem).toBe(2)
    expect(r.topics).toBe(3)
  })

  it('빈 입력에서 0으로 떨어지고 터지지 않는다', () => {
    const r = summarizeTopicGranularity([])
    expect(r).toEqual({
      maxSize: 0, maxTitle: '', over20: 0, saturated: 0,
      saturatedItems: 0, oneItem: 0, topics: 0,
    })
  })
})
