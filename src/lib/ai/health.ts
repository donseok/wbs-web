// ============================================================================
// DK Bot 헬스/관측 — 키 설정 여부, pgvector 마이그레이션 적용 여부, 색인 신선도를
// 점검한다. "무신호 실패"(키 누락·마이그레이션 미적용이 조용히 '결과 없음'으로 보이는 문제)를
// 관리자 설정 화면/헬스 엔드포인트에서 가시화하기 위한 모듈. 서버 전용.
// ============================================================================

import { aiProvider, embedConfig, hasEmbeddings, hasLLM } from './provider'
import { createAdminClient } from '@/lib/supabase/admin'

/** PostgREST 에러(또는 pg 에러)에서 Postgres SQLSTATE 코드를 추출. */
export function pgErrorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code
    if (typeof c === 'string') return c
  }
  return undefined
}

/**
 * 마이그레이션 0010(pgvector) 미적용 신호인지 판별.
 * 42P01 undefined_table / 42883 undefined_function / 42704 undefined_object(type)
 * / 3F000 invalid_schema, 또는 메시지에 관련 객체명 + "존재하지 않음"이 함께 보이는 경우.
 */
export function isSchemaMissing(e: unknown): boolean {
  const code = pgErrorCode(e)
  if (code && ['42P01', '42883', '42704', '3F000'].includes(code)) return true
  const msg =
    e instanceof Error ? e.message : typeof e === 'string' ? e : ((e as { message?: unknown })?.message as string)
  if (typeof msg === 'string') {
    const hitsObject = /wbs_embeddings|match_wbs_documents|\bvector\b/i.test(msg)
    const hitsMissing = /does not exist|존재하지\s*않|undefined|unknown function|could not find/i.test(msg)
    return hitsObject && hitsMissing
  }
  return false
}

function serviceRoleConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export type SchemaState = 'ready' | 'missing' | 'no_service_role' | 'error'

export interface DkbotHealth {
  provider: 'gemini' | 'openai'
  llm: boolean // LLM 답변 키 설정됨
  embeddings: boolean // 임베딩(의미검색) 키 설정됨
  serviceRole: boolean // service_role 키 설정됨(색인 쓰기/RPC 호출 가능)
  schema: SchemaState // pgvector 스키마/RPC 적용 상태
  detail?: string
}

/**
 * 전반적 헬스 체크. schema 는 match_wbs_documents RPC 를 단위 벡터로 1회 프로빙하여
 * vector 확장·테이블·함수 존재를 한 번에 확인한다(실데이터 변경 없음).
 */
export async function dkbotHealth(): Promise<DkbotHealth> {
  const base = {
    provider: aiProvider(),
    llm: hasLLM(),
    embeddings: hasEmbeddings(),
    serviceRole: serviceRoleConfigured(),
  }
  if (!base.serviceRole) return { ...base, schema: 'no_service_role' }
  try {
    const admin = createAdminClient()
    const dim = embedConfig().dim
    // 단위 벡터(영벡터는 코사인 거리 NaN 유발 가능 → 첫 성분만 1)로 RPC 프로빙.
    const probe = new Array(dim).fill(0)
    probe[0] = 1
    const { error } = await admin.rpc('match_wbs_documents', {
      query_embedding: probe,
      match_count: 1,
      p_project_id: null,
      p_kinds: null,
    })
    if (error) return { ...base, schema: isSchemaMissing(error) ? 'missing' : 'error', detail: error.message }
    return { ...base, schema: 'ready' }
  } catch (e) {
    return { ...base, schema: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

export type IndexFreshness = 'fresh' | 'stale' | 'empty' | 'disabled' | 'schema_missing' | 'unknown'

export interface IndexStatus {
  enabled: boolean // 임베딩 키 설정됨(의미검색 사용 가능)
  indexed: number // 이 프로젝트의 색인 문서 수
  itemCount: number // 이 프로젝트의 WBS 항목 수
  freshness: IndexFreshness
}

/**
 * 프로젝트별 색인 신선도. WBS(wbs_items.updated_at) 최신 변경이 색인(wbs_embeddings.updated_at)
 * 보다 나중이면 stale → 재색인 필요. 자동 재임베딩(무료 쿼터 소진) 대신 신선도를 노출하는 용도.
 */
export async function dkbotIndexStatus(projectId: string): Promise<IndexStatus> {
  const enabled = hasEmbeddings()
  if (!serviceRoleConfigured()) {
    return { enabled, indexed: 0, itemCount: 0, freshness: enabled ? 'unknown' : 'disabled' }
  }
  try {
    const admin = createAdminClient()
    const [emb, itemCnt, itemLatest, embLatest] = await Promise.all([
      admin.from('wbs_embeddings').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      admin.from('wbs_items').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      admin
        .from('wbs_items')
        .select('updated_at')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('wbs_embeddings')
        .select('updated_at')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (emb.error) {
      if (isSchemaMissing(emb.error)) return { enabled, indexed: 0, itemCount: itemCnt.count ?? 0, freshness: 'schema_missing' }
      return { enabled, indexed: 0, itemCount: itemCnt.count ?? 0, freshness: 'unknown' }
    }

    const indexed = emb.count ?? 0
    const itemCount = itemCnt.count ?? 0
    if (!enabled) return { enabled, indexed, itemCount, freshness: 'disabled' }
    if (itemCount === 0) return { enabled, indexed, itemCount, freshness: 'empty' }
    if (indexed === 0) return { enabled, indexed, itemCount, freshness: 'stale' } // 항목은 있는데 미색인

    const itemTs = (itemLatest.data as { updated_at?: string } | null)?.updated_at ?? null
    const embTs = (embLatest.data as { updated_at?: string } | null)?.updated_at ?? null
    const stale = !embTs || (!!itemTs && itemTs > embTs)
    return { enabled, indexed, itemCount, freshness: stale ? 'stale' : 'fresh' }
  } catch {
    return { enabled, indexed: 0, itemCount: 0, freshness: 'unknown' }
  }
}
