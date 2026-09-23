// src/components/wbs/sheetTree.ts — WBS 표의 평탄화·조상 경로(순수). stub 하위(subTasks)는 후행 바로 뒤 행으로 보인다(스펙 F9·§3.6).
import type { ComputedItem } from '@/lib/domain/types'

export function flattenForSheet(items: ComputedItem[], collapsed: Set<string>): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => {
    out.push(n)
    if (!collapsed.has(n.id)) { walk(n.children); walk(n.subTasks ?? []) }
  })
  walk(items)
  return out
}

/** focus 대상의 조상 id 경로(루트→부모 순). 트리에 없으면 null. ?focus=<하위 id> 링크가 subTasks 를 타야 한다. */
export function findAncestorPath(items: ComputedItem[], id: string): string[] | null {
  const walk = (ns: ComputedItem[], anc: string[]): string[] | null => {
    for (const n of ns) {
      if (n.id === id) return anc
      const found = walk(n.children, [...anc, n.id]) ?? walk(n.subTasks ?? [], [...anc, n.id])
      if (found) return found
    }
    return null
  }
  return walk(items, [])
}
