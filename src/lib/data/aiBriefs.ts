import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'

/** project_ai_briefs 1행(읽기 전용 뷰) — weekly 는 body_md. items 는 옛 kind='risk'(2026-08-28 카드 제거로 소비처 없음) 잔재. */
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
 * weekly 는 리포트 모달의 생성 버튼이 회수하므로 조용한 실패가 아니다).
 * 소비처는 PPT 리포트(api/report, kind='weekly')뿐이다 — 대시보드 카드(risk 해설·주간 브리핑)는
 * 2026-08-28 이슈 현황 카드로 교체되며 제거됐다. kind='risk' 행은 DB 에 남지만 읽는 곳이 없다.
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
