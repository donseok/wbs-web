// 강제 진행 버튼 노출 재료(스펙 2026-09-23 §3.2) — 관리자가 아닌 사람이 후행의 서브트리 관리자인 항목 id.
// 서버 가드(requireSubtreeManagerOrAdmin → isSubtreeManager)와 같은 규칙(isSubtreeManagerOf, F15 포함)을 쓴다.
// 화면 어포던스일 뿐이다 — 정본 판정은 서버 액션이 다시 한다.
import type { ComputedItem } from './types'
import { isSubtreeManagerOf, type AncestorLike } from './seatmap'

export function subtreeManagedIds(items: readonly ComputedItem[], memberIds: readonly string[]): string[] {
  if (memberIds.length === 0) return []
  const byId = new Map<string, AncestorLike>()
  const candidates: string[] = []
  const walk = (ns: readonly ComputedItem[]) => ns.forEach(n => {
    byId.set(n.id, { id: n.id, parent_id: n.parentId, assignee_member_id: n.assigneeMemberId ?? null, stub_for: n.stubFor ?? null })
    // 강제 진행 절이 뜨는 항목만 — 선행이 있거나 스텁 하위가 달린 리프.
    if (n.children.length === 0 && ((n.depends ?? []).length > 0 || (n.subTasks ?? []).length > 0)) candidates.push(n.id)
    walk(n.children)
    walk(n.subTasks ?? [])
  })
  walk(items)
  const mine = new Set(memberIds)
  return candidates.filter(id => isSubtreeManagerOf(id, byId, mine))
}
