// 프로젝트 생애 상태 — 날짜 + 실제 WBS 완료율 결합 판정.
// 배경: 날짜만 보던 기존 판정은 종료일이 지나면 실적 50%여도 '완료'로 표시했다.

// 'unknown' = WBS 조회 자체가 실패해 완료 여부를 알 수 없음. 실패를 'WBS 없음'으로 폴백하면
// 종료일 지난 미완 프로젝트가 '완료'로 둔갑하므로(아래 done 분기), 모름은 모름으로 표시한다.
export type ProjectLifecycleStatus = 'ready' | 'active' | 'overdue' | 'done' | 'unknown'

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
  completion: ProjectCompletion | null,   // null = 조회 실패(모름) — '완료'로 위장하지 않는다
): ProjectLifecycleStatus {
  if (!start || !end) return 'ready'
  if (today < start) return 'ready'
  if (today > end) {
    if (!completion) return 'unknown'
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
