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
export const getAiBrief = cache(async (
  projectId: string, kind: 'weekly' | 'risk', cacheKey: string,
): Promise<AiBriefRow | null> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('project_ai_briefs')
    .select('headline, body_md, items, status, input_hash, model, updated_at')
    .eq('project_id', projectId).eq('kind', kind).eq('cache_key', cacheKey)
    .maybeSingle()
  if (error) {
    console.error(`[aiBriefs] ${kind} 캐시 조회 실패:`, error.message)
    return null
  }
  if (!data) return null
  return {
    headline: (data.headline as string) ?? '',
    bodyMd: (data.body_md as string) ?? '',
    items: Array.isArray(data.items) ? (data.items as unknown[]) : [],
    status: data.status as 'ready' | 'none',
    inputHash: data.input_hash as string,
    model: (data.model as string) ?? '',
    updatedAt: data.updated_at as string,
  }
})
