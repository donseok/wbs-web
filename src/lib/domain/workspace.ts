import type { ComputedItem } from './types'

/** 워크스페이스 홈 히어로의 작업 집계(TASKS / DONE / %). */
export interface TaskStats {
  tasks: number
  done: number
  donePct: number
}

function walkLeaves(nodes: ComputedItem[], out: ComputedItem[]): void {
  for (const n of nodes) {
    if (!n.children.length) out.push(n)
    walkLeaves(n.children, out)
  }
}

/** 여러 프로젝트의 루트 트리 배열을 받아 리프(작업) 총수·완료수·완료율을 합산한다.
 *  상위(phase/task) 노드는 작업이 아니므로 제외하고, 리프만 카운트한다(대시보드/보고서와 동일 기준). */
export function aggregateTaskStats(projectTrees: ComputedItem[][]): TaskStats {
  const leaves: ComputedItem[] = []
  for (const tree of projectTrees) walkLeaves(tree, leaves)
  const tasks = leaves.length
  const done = leaves.filter(l => l.status === 'done').length
  const donePct = tasks ? Math.round((done / tasks) * 100) : 0
  return { tasks, done, donePct }
}
