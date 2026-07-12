import type { MinuteBlock } from './blocks'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'

/** 인라인 보더에 쓸 kind 우선순위 — 복수 kind 블록은 최상위 1개만 표시(스펙 §6.3). */
export const INS_PRIORITY: InsightKind[] = ['risk', 'deadline', 'decision', 'action']

/** 요약 카드 상태 — 스펙 §3.3-1. pending 은 self-heal 대기(행 0개 또는 stale). */
export type InsightCardState = 'ready' | 'empty' | 'pending'

export function insightCardState(insights: MinuteInsight[], bodyHash: string): InsightCardState {
  if (insights.length === 0) return 'pending'
  if (insights.some(i => i.bodyHash !== bodyHash)) return 'pending'
  return insights.every(i => i.kind === 'none') ? 'empty' : 'ready'
}

/** 블록 표시 규칙(스펙 §3.3-2): 인덱스 존재 + rendered + 해시 일치. none 마커 제외, (블록,kind) dedupe. */
export function visibleInsights(
  insights: MinuteInsight[], blocks: MinuteBlock[], bodyHash: string,
): MinuteInsight[] {
  const seen = new Set<string>()
  return insights.filter(i => {
    if (i.kind === 'none' || i.bodyHash !== bodyHash) return false
    const b = blocks[i.blockIndex]
    if (!b || !b.rendered || b.hash !== i.blockHash) return false
    const key = `${i.blockIndex}:${i.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function visibleHighlights(
  highlights: MinuteHighlight[], blocks: MinuteBlock[],
): MinuteHighlight[] {
  return highlights.filter(h => {
    const b = blocks[h.blockIndex]
    return !!b && b.rendered && b.hash === h.blockHash
  })
}

/** '많이 주목한 구간' — distinct 사용자 수 내림차순 상위 limit. 발췌는 현재 본문 파생(DB 저장 안 함). */
export function topHighlightedBlocks(
  highlights: MinuteHighlight[], blocks: MinuteBlock[], limit = 3,
): { blockIndex: number; count: number; excerpt: string }[] {
  const byBlock = new Map<number, Set<string>>()
  for (const h of visibleHighlights(highlights, blocks)) {
    if (!byBlock.has(h.blockIndex)) byBlock.set(h.blockIndex, new Set())
    byBlock.get(h.blockIndex)!.add(h.createdBy)
  }
  return [...byBlock.entries()]
    .map(([blockIndex, users]) => ({
      blockIndex, count: users.size, excerpt: blocks[blockIndex].text.slice(0, 100),
    }))
    .sort((a, b) => b.count - a.count || a.blockIndex - b.blockIndex)
    .slice(0, limit)
}

/** 하이라이트 배경 3단계 — 1명 / 2–3명 / 4명+ (스펙 §6.3). */
export function hlTier(count: number): 1 | 2 | 3 {
  return count >= 4 ? 3 : count >= 2 ? 2 : 1
}
