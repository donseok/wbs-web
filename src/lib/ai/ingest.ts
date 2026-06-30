import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getProjectName } from './knowledge'
import { buildDocuments } from './analytics'
import { embedDocuments } from './embeddings'
import { hasEmbeddings } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { chunked } from './util'

export interface IngestResult {
  count: number
  skipped?: boolean
  reason?: string
  /** 임베딩에 실패해 색인에서 빠진 항목 수(부분 성공 시 > 0). */
  skippedItems?: number
}

/**
 * 프로젝트의 WBS/멤버를 임베딩해 wbs_embeddings 에 재색인(전체 교체).
 * 임베딩 키가 없으면 조용히 skip(구조화 질의만으로도 봇은 동작). 서버 전용.
 */
export async function ingestProject(projectId: string): Promise<IngestResult> {
  if (!hasEmbeddings()) return { count: 0, skipped: true, reason: 'no_embedding_key' }

  const [{ items, today }, members, name] = await Promise.all([
    getComputedWbs(projectId),
    getProjectMembers(projectId),
    getProjectName(projectId),
  ])
  const docs = buildDocuments(items, name, today, members)
  if (docs.length === 0) return { count: 0 }

  const vectors = await embedDocuments(
    docs.map(d => d.content),
    'RETRIEVAL_DOCUMENT',
  )
  if (!vectors) return { count: 0, skipped: true, reason: 'embed_failed' } // 키 없음 → 의미검색 비활성

  // 부분 성공 허용: 임베딩에 성공한 항목만 색인한다(한 항목의 실패로 전체가 0이 되지 않도록).
  const rows = docs
    .map((d, i) => ({ d, v: vectors[i] }))
    .filter((x): x is { d: (typeof docs)[number]; v: number[] } => x.v !== null)
    .map(({ d, v }) => ({
      project_id: projectId,
      kind: d.kind,
      ref_id: d.refId,
      content: d.content,
      embedding: v,
    }))
  const skippedItems = docs.length - rows.length

  // 전부 실패 → 기존 색인을 지우지 않고 그대로 보존(스테일이 무색인보다 낫다).
  if (rows.length === 0) return { count: 0, skipped: true, reason: 'embed_failed', skippedItems }

  const admin = createAdminClient()
  // 전체 교체: 기존 문서 삭제 후 재삽입(스테일 방지).
  const { error: delErr } = await admin.from('wbs_embeddings').delete().eq('project_id', projectId)
  if (delErr) throw new Error(delErr.message)

  for (const batch of chunked(rows, 200)) {
    const { error } = await admin.from('wbs_embeddings').insert(batch)
    if (error) throw new Error(error.message)
  }
  return skippedItems > 0 ? { count: rows.length, skippedItems } : { count: rows.length }
}
