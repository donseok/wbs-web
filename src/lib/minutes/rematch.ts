import { isMarkableBlock, type MinuteBlock } from './blocks'

/** minute_highlights 행 스냅샷(snake_case — service_role 재삽입에 그대로 사용). */
export interface HighlightRow {
  id: string
  created_by: string
  created_by_name: string | null
  block_index: number
  block_hash: string
  created_at: string
}

/**
 * 본문 교체 시 하이라이트 재배정 — 스펙 §5.
 * 사용자별·해시별로 옛 행(옛 인덱스 순)을 같은 해시의 새 마킹 가능 블록 큐(문서 순)에 1:1 배정.
 * 적용은 delete(deleteIds ∪ reinserts 원 id) 선실행 → reinserts 일괄 insert —
 * unique (minute_id, created_by, block_index) 가 non-deferrable 이라 행별 UPDATE 는
 * 시프트/스왑에서 반드시 23505 가 나기 때문(행 단위 즉시 검사).
 */
export function rematchHighlights(
  old: HighlightRow[], newBlocks: MinuteBlock[],
): { reinserts: HighlightRow[]; deleteIds: string[] } {
  // 해시 → 새 블록 인덱스 큐 (문서 순, 마킹 가능 블록만)
  const queues = new Map<string, number[]>()
  for (const b of newBlocks) {
    if (!isMarkableBlock(b)) continue
    if (!queues.has(b.hash)) queues.set(b.hash, [])
    queues.get(b.hash)!.push(b.index)
  }

  const reinserts: HighlightRow[] = []
  const deleteIds: string[] = []

  // 사용자별 그룹 — 서로 다른 사용자는 같은 새 인덱스를 공유할 수 있음(unique 는 사용자 스코프)
  const byUser = new Map<string, HighlightRow[]>()
  for (const r of old) {
    if (!byUser.has(r.created_by)) byUser.set(r.created_by, [])
    byUser.get(r.created_by)!.push(r)
  }

  for (const rows of byUser.values()) {
    // 사용자 내 해시별 소비 위치(큐는 사용자 간 공유가 아니라 사용자별 복사 소비)
    const cursor = new Map<string, number>()
    for (const r of [...rows].sort((a, b) => a.block_index - b.block_index)) {
      const q = queues.get(r.block_hash) ?? []
      const pos = cursor.get(r.block_hash) ?? 0
      if (pos >= q.length) { deleteIds.push(r.id); continue }
      cursor.set(r.block_hash, pos + 1)
      const newIndex = q[pos]
      if (newIndex === r.block_index) continue  // 무변경
      deleteIds.push(r.id)
      reinserts.push({ ...r, block_index: newIndex })
    }
  }
  return { reinserts, deleteIds }
}
