import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'

/** project_ai_briefs 1행(읽기 전용 뷰) — items 는 kind='risk' 만 사용, weekly 는 body_md. */
export interface AiBriefRow {
  headline: string
  bodyMd: string
  items: unknown[]
  status: 'ready' | 'none'
  inputHash: string
  model: string
  updatedAt: string
}

/**
 * AI 브리핑 캐시 조회 — RLS 사용자 클라이언트, 항상 단독 쿼리(임베드 금지 —
 * minute_insights 2026-07 실사고 규칙). 실패는 로깅 후 null(행 없음과 동일 취급 —
 * weekly 는 버튼이, risk 는 self-heal 이 회수하므로 조용한 실패가 아니다).
 */
const BRIEF_COLS = 'headline, body_md, items, status, input_hash, model, updated_at'

function toBriefRow(data: Record<string, unknown>): AiBriefRow {
  return {
    headline: (data.headline as string) ?? '',
    bodyMd: (data.body_md as string) ?? '',
    items: Array.isArray(data.items) ? (data.items as unknown[]) : [],
    status: data.status as 'ready' | 'none',
    inputHash: data.input_hash as string,
    model: (data.model as string) ?? '',
    updatedAt: data.updated_at as string,
  }
}

export const getAiBrief = cache(async (
  projectId: string, kind: 'weekly' | 'risk', cacheKey: string,
): Promise<AiBriefRow | null> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('project_ai_briefs')
    .select(BRIEF_COLS)
    .eq('project_id', projectId).eq('kind', kind).eq('cache_key', cacheKey)
    .maybeSingle()
  if (error) {
    console.error(`[aiBriefs] ${kind} 캐시 조회 실패:`, error.message)
    return null
  }
  if (!data) return null
  return toBriefRow(data as Record<string, unknown>)
})

/**
 * 프로젝트의 브리핑 캐시 전량을 1왕복으로 읽어 `kind:cache_key` 로 색인한다.
 *
 * 대시보드는 risk(cache_key='')와 weekly(cache_key=기준일)를 함께 쓰는데, weekly 의 키가
 * getComputedWbs 의 today(=projects.base_date) 라서 단건 조회로는 "기준일 왕복 → 브리핑 왕복"
 * 직렬 2단을 피할 수 없다. 배치 안에서 체이닝해도 체인 자체가 2단이라 절감이 없다.
 * (project_id, kind, cache_key) 가 유니크(0030:46)이므로 전량을 받아 골라 쓰면 같은 결과를 1단에 얻는다.
 * 행 수는 프로젝트당 kind×기준일 몇 건이라 페이로드 증가는 무시할 만하다.
 *
 * 단독 쿼리를 유지한다 — 부모 리소스 select 에 임베드하지 않는다(minute_insights 2026-07 실사고 규칙).
 * 실패는 getAiBrief 와 동일하게 '행 없음'으로 다룬다(weekly 는 생성 버튼이, risk 는 self-heal 이 회수).
 */
export const getProjectAiBriefs = cache(async (
  projectId: string,
): Promise<Map<string, AiBriefRow>> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('project_ai_briefs')
    .select(`kind, cache_key, ${BRIEF_COLS}`)
    .eq('project_id', projectId)
  if (error) {
    console.error('[aiBriefs] 브리핑 캐시 일괄 조회 실패:', error.message)
    return new Map()
  }
  const map = new Map<string, AiBriefRow>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    map.set(`${r.kind as string}:${r.cache_key as string}`, toBriefRow(r))
  }
  return map
})

/** getProjectAiBriefs 결과에서 한 건 꺼내기 — 없으면 null(getAiBrief 와 동일 계약). */
export function briefFrom(
  briefs: Map<string, AiBriefRow>, kind: 'weekly' | 'risk', cacheKey: string,
): AiBriefRow | null {
  return briefs.get(`${kind}:${cacheKey}`) ?? null
}
