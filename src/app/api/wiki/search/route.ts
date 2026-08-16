import { NextResponse, type NextRequest } from 'next/server'
import { embedDocuments } from '@/lib/ai/embeddings'
import { createLexicalSearch, toFusionCandidate } from '@/lib/ai/index/lexical'
import { deriveSearchKeywords } from '@/lib/ai/index/hybrid'
import { CURRENT_INDEX_VERSION } from '@/lib/ai/index/content'
import { INDEX_BACKFILL_DOMAINS } from '@/lib/ai/index/backfill'
import { getActorViewState } from '@/lib/authz'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { decideSearchAccess } from '@/lib/domain/searchAccess'
import { fuseSearchResults, preferBodyChunk } from '@/lib/domain/searchFusion'
import type { SupabaseKnowledgeClient } from '@/lib/ai/index/pgvector'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_QUERY_CHARS = 200
const CANDIDATE_LIMIT = 50
const RESULT_LIMIT = 20

/**
 * 검색 전 안내 패널용 코퍼스 집계 — "여기서 무엇을 찾을 수 있나" 를 실데이터로 보여준다.
 * 문서 수는 chunk_no=0 행 수와 같다(모든 문서는 0번 청크를 가진다). 인가 체인은 POST 와
 * 동일 — ai_documents 의 RLS 가 authenticated 전체 개방이라 이 판정이 유일한 관문이다.
 */
export async function GET(request: NextRequest) {
  const { actor, degraded } = await getActorViewState()
  if (degraded) return NextResponse.json({ error: 'ACTOR_LOOKUP_FAILED' }, { status: 503 })
  if (!actor?.userId) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const projectId = request.nextUrl.searchParams.get('projectId') ?? ''
  const admin = createAdminClient()
  const scope = await createSupabaseAccessScopeResolver(admin).resolve(actor.userId)
  const access = decideSearchAccess(projectId, scope)
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.status })

  const counts = await Promise.all(INDEX_BACKFILL_DOMAINS.map(async domain => {
    const { count, error } = await admin
      .from('ai_documents')
      .select('id', { count: 'exact', head: true })
      .eq('chunk_no', 0)
      .eq('domain', domain)
      .in('project_id', access.projectIds)
    return { domain, docs: count ?? 0, error }
  }))

  // 집계 실패를 0건으로 위장하지 않는다(에러 처리 3원칙) — 패널은 실패 문구를 보여준다.
  const failed = counts.find(row => row.error)
  if (failed) {
    console.error('[search] 코퍼스 집계 실패:', failed.domain, failed.error)
    return NextResponse.json({ error: 'STATS_FAILED' }, { status: 503 })
  }

  const domains = counts.map(({ domain, docs }) => ({ domain, docs }))
  return NextResponse.json({
    domains,
    total: domains.reduce((sum, row) => sum + row.docs, 0),
  })
}

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

  // 키워드 추출: 자연어 다중 토큰 질의를 OR 매칭으로 풀이한다.
  // word_similarity(다중토큰, 본문) 은 구조적으로 임계(0.6)를 못 넘는다(단일 trigram 구간만 인정).
  // → 토큰을 배열로 넘겨 각각 OR 로 매칭한다(0084 의 unnest join 형태).
  const keywords = deriveSearchKeywords(query)

  // 임베딩이 실패해도 검색이 통째로 죽으면 안 된다 — 어휘 다리로 계속한다.
  const embeddings = await embedDocuments([query], 'RETRIEVAL_QUERY').catch(() => null)
  const queryEmbedding = embeddings?.[0] ?? null
  let embeddingFailed = queryEmbedding === null

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
          p_index_version: CURRENT_INDEX_VERSION,
        })
      : Promise.resolve({ data: [], error: null }),
    // 키워드가 없으면 어휘 검색을 건너뛴다 — 빈 결과 반환
    keywords.length > 0
      ? lexicalSearch({ tokens: keywords, projectIds: access.projectIds, limit: CANDIDATE_LIMIT })
      : Promise.resolve({ ok: true, candidates: [] }),
  ])

  if (vectorRows.error) {
    console.error('[search] 벡터 검색 실패:', vectorRows.error)
    return NextResponse.json({ error: 'VECTOR_SEARCH_FAILED' }, { status: 503 })
  }
  if (!lexicalResult.ok) {
    // 어휘 검색 실패도 임베딩 실패처럼 degraded 로 처리한다 — 양쪽 실패만 503.
    console.error('[search] 어휘 검색 실패:', (lexicalResult as { ok: false; errorCode: string }).errorCode)
    embeddingFailed = true
  }

  const vector = (Array.isArray(vectorRows.data) ? vectorRows.data as Array<Record<string, unknown>> : [])
    .flatMap(row => { const c = toFusionCandidate(row); return c ? [c] : [] })

  const lexicalCandidates = lexicalResult.ok ? lexicalResult.candidates : []

  // 융합 직후 머리말 전용 청크를 같은 문서의 본문 청크로 교체한다(청크 하나만 보고는
  // 문서에 본문이 있는지 알 수 없어 fuseSearchResults 안에서는 판정할 수 없다).
  const fused = fuseSearchResults(vector, lexicalCandidates, RESULT_LIMIT)
  return NextResponse.json({
    results: preferBodyChunk(fused, [...vector, ...lexicalCandidates]),
    degraded: embeddingFailed,
  })
}
