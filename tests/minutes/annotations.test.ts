import { describe, it, expect } from 'vitest'
import { splitMinuteBlocks, fnv1a64 } from '@/lib/minutes/blocks'
import {
  insightCardState, visibleInsights, visibleHighlights, topHighlightedBlocks, hlTier,
} from '@/lib/minutes/annotations'
import type { MinuteHighlight, MinuteInsight } from '@/lib/domain/types'

const MD = '# 제목\n\n결정: REST 방식 확정\n\n담당자는 7/18까지 제출'
const blocks = splitMinuteBlocks(MD)
const bodyHash = fnv1a64(MD)

const ins = (over: Partial<MinuteInsight>): MinuteInsight => ({
  id: 'i1', minuteId: 'm1', bodyHash, kind: 'decision', label: 'REST 확정',
  blockIndex: 1, blockHash: blocks[1].hash, ...over,
})
const hl = (over: Partial<MinuteHighlight>): MinuteHighlight => ({
  id: 'h1', minuteId: 'm1', blockIndex: 1, blockHash: blocks[1].hash,
  createdBy: 'u1', createdByName: '김철수', createdAt: '2026-07-12T00:00:00Z', ...over,
})

describe('insightCardState', () => {
  it('행 0개 → pending (미생성/실패 — self-heal 대상)', () => {
    expect(insightCardState([], bodyHash)).toBe('pending')
  })
  it('body_hash 불일치 행이 하나라도 있으면 → pending (stale)', () => {
    expect(insightCardState([ins({ bodyHash: 'deadbeef00000000' })], bodyHash)).toBe('pending')
  })
  it('fresh + none 마커만 → empty', () => {
    expect(insightCardState([ins({ kind: 'none', blockIndex: -1, blockHash: '', label: '' })], bodyHash)).toBe('empty')
  })
  it('fresh + 항목 → ready', () => {
    expect(insightCardState([ins({})], bodyHash)).toBe('ready')
  })
})

describe('visibleInsights', () => {
  it('none 마커는 블록 표시 규칙 대상이 아님 — 목록에서 제외', () => {
    expect(visibleInsights([ins({ kind: 'none', blockIndex: -1, blockHash: '' })], blocks, bodyHash)).toEqual([])
  })
  it('해시 불일치(orphan) 항목 숨김', () => {
    expect(visibleInsights([ins({ blockHash: 'ffffffffffffffff' })], blocks, bodyHash)).toEqual([])
  })
  it('인덱스 범위 밖 숨김', () => {
    expect(visibleInsights([ins({ blockIndex: 99 })], blocks, bodyHash)).toEqual([])
  })
  it('(blockIndex, kind) 중복은 1개만 (동시 생성 경합 방어)', () => {
    const list = visibleInsights([ins({ id: 'a' }), ins({ id: 'b' })], blocks, bodyHash)
    expect(list).toHaveLength(1)
  })
  it('정합 항목은 통과', () => {
    expect(visibleInsights([ins({})], blocks, bodyHash)).toHaveLength(1)
  })
})

describe('visibleHighlights', () => {
  it('인덱스+해시 일치만 통과', () => {
    expect(visibleHighlights([hl({})], blocks)).toHaveLength(1)
    expect(visibleHighlights([hl({ blockHash: 'ffffffffffffffff' })], blocks)).toEqual([])
    expect(visibleHighlights([hl({ blockIndex: 99 })], blocks)).toEqual([])
  })
})

describe('topHighlightedBlocks', () => {
  it('distinct 사용자 수 내림차순, 동률은 블록 순, 발췌는 현재 본문 파생(100자)', () => {
    const hs = [
      hl({ id: 'a', blockIndex: 1, blockHash: blocks[1].hash, createdBy: 'u1' }),
      hl({ id: 'b', blockIndex: 1, blockHash: blocks[1].hash, createdBy: 'u2' }),
      hl({ id: 'c', blockIndex: 2, blockHash: blocks[2].hash, createdBy: 'u1' }),
    ]
    const top = topHighlightedBlocks(hs, blocks)
    expect(top[0]).toMatchObject({ blockIndex: 1, count: 2 })
    expect(top[0].excerpt).toBe(blocks[1].text.slice(0, 100))
    expect(top[1]).toMatchObject({ blockIndex: 2, count: 1 })
  })
  it('limit 기본 3', () => {
    const hs = [0, 1, 2, 3].flatMap(i =>
      i < blocks.length ? [hl({ id: `x${i}`, blockIndex: i, blockHash: blocks[i].hash })] : [])
    expect(topHighlightedBlocks(hs, blocks).length).toBeLessThanOrEqual(3)
  })
})

describe('hlTier', () => {
  it('1명=1, 2~3명=2, 4명+=3', () => {
    expect(hlTier(1)).toBe(1); expect(hlTier(2)).toBe(2)
    expect(hlTier(3)).toBe(2); expect(hlTier(4)).toBe(3); expect(hlTier(9)).toBe(3)
  })
})
