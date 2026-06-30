import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getProjectName } from './knowledge'
import { buildDocuments } from './analytics'
import { embedTexts } from './embeddings'
import { hasEmbeddings } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'
import { chunked } from './util'

export interface IngestResult {
  count: number
  skipped?: boolean
  reason?: string
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

  const vectors = await embedTexts(
    docs.map(d => d.content),
    'RETRIEVAL_DOCUMENT',
  )
  if (!vectors) return { count: 0, skipped: true, reason: 'embed_failed' }

  const admin = createAdminClient()
  // 전체 교체: 기존 문서 삭제 후 재삽입(스테일 방지).
  const { error: delErr } = await admin.from('wbs_embeddings').delete().eq('project_id', projectId)
  if (delErr) throw new Error(delErr.message)

  const rows = docs.map((d, i) => ({
    project_id: projectId,
    kind: d.kind,
    ref_id: d.refId,
    content: d.content,
    embedding: vectors[i],
  }))
  for (const batch of chunked(rows, 200)) {
    const { error } = await admin.from('wbs_embeddings').insert(batch)
    if (error) throw new Error(error.message)
  }
  return { count: rows.length }
}
