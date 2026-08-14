import { NextResponse, type NextRequest } from 'next/server'
import { embedDocuments } from '@/lib/ai/embeddings'
import { createLexicalSearch, toFusionCandidate } from '@/lib/ai/index/lexical'
import { getActorViewState } from '@/lib/authz'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { decideSearchAccess } from '@/lib/domain/searchAccess'
import { fuseSearchResults } from '@/lib/domain/searchFusion'
import type { SupabaseKnowledgeClient } from '@/lib/ai/index/pgvector'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_QUERY_CHARS = 200
const CANDIDATE_LIMIT = 50
const RESULT_LIMIT = 20

export async function POST(request: NextRequest) {
  // getActorViewState() 는 { actor, degraded } 를 반환한다.
  // actor 는 인증 성공/실패 구분, degraded 는 조회 실패 여부.
  // 이를 분리해야 에러 처리 3원칙을 지킨다(조회 실패를 인증 실패로 위장하지 않음).
  const { actor, degraded } = await getActorViewState()
  if (degraded) return NextResponse.json({ error: 'ACTOR_LOOKUP_FAILED' }, { status: 503 })
  if (!actor?.userId) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const body = await request.json().catch(() => null) as { projectId?: unknown; q?: unknown } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const query = (typeof body?.q === 'string' ? body.q : '').slice(0, MAX_QUERY_CHARS).trim()

  const admin = createAdminClient()
  const scope = await createSupabaseAccessScopeResolver(admin).resolve(actor.userId)

  // 이 판정이 유일한 관문이다 — ai_documents 의 RLS 는 authenticated using (true) 다.
  const access = decideSearchAccess(projectId, scope)
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.status })

  if (!query) return NextResponse.json({ results: [], degraded: false })

  // 임베딩이 실패해도 검색이 통째로 죽으면 안 된다 — 어휘 다리로 계속한다.
  const embeddings = await embedDocuments([query], 'RETRIEVAL_QUERY').catch(() => null)
  const queryEmbedding = embeddings?.[0] ?? null

  // createLexicalSearch 는 구조적 인터페이스 SupabaseKnowledgeClient 를 받는다.
  // 리포 관용구대로 이중 캐스트로 넘긴다.
  const lexicalSearch = createLexicalSearch(admin as unknown as SupabaseKnowledgeClient)
  const [vectorRows, lexicalResult] = await Promise.all([
    queryEmbedding
      ? admin.rpc('match_ai_documents', {
          query_embedding: queryEmbedding,
          match_count: CANDIDATE_LIMIT,
          p_project_ids: access.projectIds,
          p_include_global: false,
          p_domains: null,
          p_entity_types: null,
          p_team: null,
          p_date_from: null,
          p_date_to: null,
          p_index_version: 1,
        })
      : Promise.resolve({ data: [], error: null }),
    lexicalSearch({ query, projectIds: access.projectIds, limit: CANDIDATE_LIMIT }),
  ])

  if (vectorRows.error) {
    console.error('[search] 벡터 검색 실패:', vectorRows.error)
    return NextResponse.json({ error: 'VECTOR_SEARCH_FAILED' }, { status: 503 })
  }
  if (!lexicalResult.ok) {
    return NextResponse.json({ error: lexicalResult.errorCode }, { status: 503 })
  }

  const vector = (Array.isArray(vectorRows.data) ? vectorRows.data as Array<Record<string, unknown>> : [])
    .flatMap(row => { const c = toFusionCandidate(row); return c ? [c] : [] })

  return NextResponse.json({
    results: fuseSearchResults(vector, lexicalResult.candidates, RESULT_LIMIT),
    degraded: queryEmbedding === null,
  })
}
