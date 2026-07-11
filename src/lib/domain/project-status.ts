// 프로젝트 생애 상태 — 날짜 + 실제 WBS 완료율 결합 판정.
// 배경: 날짜만 보던 기존 판정은 종료일이 지나면 실적 50%여도 '완료'로 표시했다.

export type ProjectLifecycleStatus = 'ready' | 'active' | 'overdue' | 'done'

export interface ProjectCompletion {
  hasWbs: boolean
  allDone: boolean
}

export interface CompletionRow {
  id: string
  parentId: string | null
  projectId: string
  actualPct: number | null
}

export function projectLifecycleStatus(
  start: string | null,
  end: string | null,
  today: string,
  completion: ProjectCompletion,
): ProjectLifecycleStatus {
  if (!start || !end) return 'ready'
  if (today < start) return 'ready'
  if (today > end) {
    // WBS가 없으면 판단 근거가 없으므로 날짜 기준(done)을 유지한다.
    if (!completion.hasWbs) return 'done'
    return completion.allDone ? 'done' : 'overdue'
  }
  return 'active'
}

// done 판정은 원시값 >= 100 (statusOf와 동일 규약 — 반올림 금지)
export function computeCompletionMap(rows: CompletionRow[]): Record<string, ProjectCompletion> {
  const parents = new Set<string>()
  for (const r of rows) if (r.parentId) parents.add(r.parentId)
  const map: Record<string, ProjectCompletion> = {}
  for (const r of rows) {
    if (parents.has(r.id)) continue // 리프만 (자식 유무 판정 — level 아님)
    const cur = map[r.projectId] ?? { hasWbs: false, allDone: true }
    cur.hasWbs = true
    if ((r.actualPct ?? 0) < 100) cur.allDone = false
    map[r.projectId] = cur
  }
  return map
}
