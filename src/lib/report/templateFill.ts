import type { NarrativeGroup } from './narrative'

/* ── 셀 용량 캡(순수). 템플릿 셀 높이가 고정 → 페이지 분할 없이 한 칸에 맞게 요약. ── */

/** 항목 목록을 max개로 제한(초과분은 '외 N건'). */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max - 1), `외 ${items.length - (max - 1)}건`]
}

/** 그룹들의 총 줄수(그룹당 헤더1 + 항목수)가 budget 이내가 되도록 그룹별 항목을 균등 캡.
 *  그룹 수는 보존. 헤더만으로 예산 초과면 각 그룹 항목 0으로. */
export function capGroupsToBudget(groups: NarrativeGroup[], budget: number): NarrativeGroup[] {
  if (!groups.length) return groups
  const itemBudget = Math.max(0, budget - groups.length)
  const perGroup = Math.max(0, Math.floor(itemBudget / groups.length))
  return groups.map(g => ({ phase: g.phase, num: g.num, items: capItems(g.items, perGroup || 1).slice(0, perGroup) }))
}
