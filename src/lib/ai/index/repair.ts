import { embedDocuments } from '@/lib/ai/embeddings'
import type { SupabaseKnowledgeClient } from './pgvector'

// 크론 워커(/api/chat/index/worker)와 수동 재색인(/api/wiki/reindex) 양쪽이 같은 복구
// 로직을 쓴다 — 워커 라우트에서 추출(로직 중복 금지). 동작은 그대로다.

interface RepairRow {
  id: string
  content: string
}

function isRepairRow(value: unknown): value is RepairRow {
  return (
    typeof value === 'object' && value !== null
    && typeof (value as Record<string, unknown>).id === 'string'
    && typeof (value as Record<string, unknown>).content === 'string'
  )
}

export type RepairResult =
  | { scanned: number; repaired: number; stillNull: number }
  | { error: string; status: number }

/**
 * embedding is null 인 행만 골라 재임베딩한다(0085 클로버 방지의 짝 — 이미 null이 된 행 복구).
 * 성공한 것만 UPDATE 한다. 실패는 다음 호출을 위해 null인 채로 둔다(에러 처리 3원칙: 위장 금지).
 */
export async function runRepairOnce(
  admin: SupabaseKnowledgeClient,
  limit: number,
): Promise<RepairResult> {
  const { data, error } = await admin
    .from('ai_documents')
    .select('id, content')
    .is('embedding', null)
    .limit(limit)
  if (error) return { error: 'null 임베딩 행을 조회하지 못했습니다.', status: 503 }
  if (!Array.isArray(data)) return { error: 'null 임베딩 행을 조회하지 못했습니다.', status: 503 }
  const rows = data.filter(isRepairRow)
  if (rows.length === 0) return { scanned: 0, repaired: 0, stillNull: 0 }

  const vectors = await embedDocuments(rows.map(row => row.content), 'RETRIEVAL_DOCUMENT')
  if (vectors === null) {
    // 키가 없어 호출 자체를 못 한 경우 — 전부 미복구로 정직하게 보고한다.
    return { scanned: rows.length, repaired: 0, stillNull: rows.length }
  }

  let repaired = 0
  for (let i = 0; i < rows.length; i++) {
    const vector = vectors[i]
    if (!vector) continue // 실패한 항목은 건드리지 않는다 — null 유지
    const { error: updateError } = await admin
      .from('ai_documents')
      .update({ embedding: vector })
      .eq('id', rows[i].id)
    if (!updateError) repaired++
  }
  return { scanned: rows.length, repaired, stillNull: rows.length - repaired }
}
