/** WBS 단계(레벨) 설정 검증 — 라벨 배열이 곧 깊이 정의(labels.length = maxDepth).
 *  라벨과 max_depth 를 따로 관리하면 불일치가 생기므로 묶는다(스펙 2026-08-21-wbs-nlevel-md-contract §구현 범위 1). */

export const LEVEL_LABELS_MAX = 10

export interface LevelSettingsInput {
  labels: string[]
  /** 기존 트리의 최대 depth(0-base). 트리가 비어 있으면 null — 축소 검증을 건너뛴다. */
  currentTreeMaxDepth: number | null
}

export type LevelSettingsResult =
  | { ok: true; labels: string[]; maxDepth: number }
  | { ok: false; error: string }

/** parent_id 체인에서 트리 최대 깊이(0-base). 빈 트리는 null.
 *  부모가 집합에 없는 고아는 루트 취급, 순환은 방문 표시로 끊는다 — 어느 쪽도 깊이를 과대평가하지 않는다. */
export function treeMaxDepth(rows: ReadonlyArray<{ id: string; parent_id: string | null }>): number | null {
  if (rows.length === 0) return null
  const parentOf = new Map(rows.map((r) => [r.id, r.parent_id]))
  const depthOf = new Map<string, number>()
  const resolve = (id: string): number => {
    const known = depthOf.get(id)
    if (known !== undefined) return known
    depthOf.set(id, 0) // 순환 가드 — 재방문 시 0 으로 끊긴다
    const p = parentOf.get(id)
    const d = p != null && parentOf.has(p) ? resolve(p) + 1 : 0
    depthOf.set(id, d)
    return d
  }
  let max = 0
  for (const r of rows) max = Math.max(max, resolve(r.id))
  return max
}

export function validateLevelSettings(input: LevelSettingsInput): LevelSettingsResult {
  const labels = input.labels.map((l) => l.trim())
  if (labels.length === 0) return { ok: false, error: '단계가 최소 1개 필요합니다.' }
  if (labels.length > LEVEL_LABELS_MAX) {
    return { ok: false, error: `단계는 최대 ${LEVEL_LABELS_MAX}개까지입니다.` }
  }
  const emptyIdx = labels.findIndex((l) => l === '')
  if (emptyIdx >= 0) return { ok: false, error: `${emptyIdx + 1}번째 단계 이름이 비어 있습니다.` }
  if (new Set(labels).size !== labels.length) {
    return { ok: false, error: '단계 이름이 중복됩니다.' }
  }
  if (input.currentTreeMaxDepth != null && labels.length < input.currentTreeMaxDepth + 1) {
    return {
      ok: false,
      error: `기존 WBS 에 깊이 ${input.currentTreeMaxDepth + 1}단 항목이 있어 ${labels.length}단으로 줄일 수 없습니다.`,
    }
  }
  return { ok: true, labels, maxDepth: labels.length }
}
