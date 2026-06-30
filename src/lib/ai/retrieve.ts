import { embedTexts } from './embeddings'
import { hasEmbeddings } from './provider'
import { isSchemaMissing } from './health'
import { createServerClient } from '@/lib/supabase/server'

export interface Match {
  kind: string
  refId: string | null
  content: string
  similarity: number
  projectId: string
}

interface RawMatch {
  id: string
  project_id: string
  kind: string
  ref_id: string | null
  content: string
  similarity: number
}

// 코사인 유사도 하한. 이보다 낮은(=의미적으로 먼) 결과는 '관련 작업'으로 제시하지 않는다.
// 임계값 미만이면 무관한 질문에도 가장 가까운 행들이 끌려와 근거를 흐리므로 컷한다.
// 실데이터로 튜닝하려면 DKBOT_MIN_SIMILARITY(0~1) 로 덮어쓸 수 있다.
const MIN_SIMILARITY = (() => {
  const v = Number(process.env.DKBOT_MIN_SIMILARITY)
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.55
})()

/**
 * 질문을 임베딩해 pgvector 의미검색(match_wbs_documents)으로 관련 문서 top-K 회수.
 * projectId=null 이면 전사 검색. 임베딩 키 없음/오류 시 빈 배열(=구조화 답변만 사용).
 *
 * 읽기는 사용자 세션(RLS) 클라이언트로 수행한다 — service_role 로 RLS 를 우회하지 않으므로,
 * wbs_embeddings 의 행 수준 정책이 그대로 적용된다(앱의 read-all 정책과 일관, 향후 정책 강화 시 자동 반영).
 */
export async function retrieveContext(query: string, projectId: string | null, k = 8): Promise<Match[]> {
  if (!hasEmbeddings()) return []
  const vecs = await embedTexts([query], 'RETRIEVAL_QUERY')
  if (!vecs || !vecs[0]?.length) return []

  // 의미검색은 부가 기능 — 어떤 실패(세션 없음, 마이그레이션 미적용, RPC 오류)든
  // 빈 배열로 강등해 결정형 답변 경로가 끊기지 않게 한다(/api/chat 가 500 나지 않도록).
  try {
    const sb = await createServerClient()
    const { data, error } = await sb.rpc('match_wbs_documents', {
      query_embedding: vecs[0],
      match_count: k,
      p_project_id: projectId,
      p_kinds: null,
    })
    if (error) {
      if (isSchemaMissing(error)) {
        console.error(
          '[dkbot] 의미검색 비활성: pgvector 마이그레이션(0010)이 적용되지 않은 것으로 보입니다. docs/dkbot.md 참고 →',
          error.message,
        )
      } else {
        console.error('[dkbot] match_wbs_documents 실패:', error.message)
      }
      return []
    }
    return ((data as RawMatch[] | null) ?? [])
      .filter(m => m.similarity >= MIN_SIMILARITY) // 약한 매칭은 근거에서 제외
      .map(m => ({
        kind: m.kind,
        refId: m.ref_id,
        content: m.content,
        similarity: m.similarity,
        projectId: m.project_id,
      }))
  } catch (e) {
    console.error('[dkbot] 의미검색 사용 불가(세션/연결 문제) → 결정형 답변으로 폴백:', e instanceof Error ? e.message : e)
    return []
  }
}
