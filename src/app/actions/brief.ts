'use server'
// 주간 AI 브리핑 서버 액션 — ensureMinuteInsightsAction 미러의 게이트 구조.
// 세션+멤버십 fail-closed(무료 쿼터 보호): 비로그인/비멤버는 LLM 경로 진입 자체가 불가.
// 데이터는 클라이언트 입력을 믿지 않고 loadProjectFacts 로 서버에서 재로드한다.
import { getMembership, getSession } from '@/lib/auth'
import { loadProjectFacts } from '@/lib/ai/projectFacts'
import { briefFactsHash, buildBriefFacts, ensureWeeklyBrief } from '@/lib/ai/brief'
import { getAiBrief } from '@/lib/data/aiBriefs'

export interface WeeklyBriefPayload {
  state: 'ready' | 'generated' | 'unavailable'
  headline?: string
  bodyMd?: string
  kpiLine?: string
  updatedAt?: string
  model?: string
  baseDate?: string
  realToday?: string
  fresh?: boolean
}

/** 브리핑 생성/재생성(버튼 온디맨드 전용). force=데이터 무변경이어도 재생성(쿨다운 유지). */
export async function ensureProjectBriefAction(
  projectId: string, opts?: { force?: boolean },
): Promise<WeeklyBriefPayload> {
  const m = await getMembership()
  if (!m) return { state: 'unavailable' }
  const user = await getSession()
  if (!user) return { state: 'unavailable' }
  try {
    const src = await loadProjectFacts(projectId)
    if (!src) return { state: 'unavailable' }
    const facts = buildBriefFacts(src)
    const state = await ensureWeeklyBrief(projectId, facts, opts)
    const row = await getAiBrief(projectId, 'weekly', facts.todayWbs)
    if (!row) return { state: 'unavailable', kpiLine: facts.kpiLine, baseDate: facts.todayWbs, realToday: facts.todayReal }
    return {
      state,
      headline: row.headline,
      bodyMd: row.bodyMd,
      kpiLine: facts.kpiLine,
      updatedAt: row.updatedAt,
      model: row.model,
      baseDate: facts.todayWbs,
      realToday: facts.todayReal,
      fresh: row.inputHash === briefFactsHash(facts),
    }
  } catch (e) {
    // 표시 강등에는 로깅 동반(silent-empty 3원칙)
    console.error('[brief] ensureProjectBriefAction 실패:', e instanceof Error ? e.message : e)
    return { state: 'unavailable' }
  }
}

export interface BriefStatusPayload {
  fresh: boolean
  hasBrief: boolean
  baseDate: string | null
}

/** ReportModal 신선도 조회 — LLM 0콜(캐시 읽기 + 해시 대조만). */
export async function getProjectBriefAction(projectId: string): Promise<BriefStatusPayload> {
  const m = await getMembership()
  if (!m) return { fresh: false, hasBrief: false, baseDate: null }
  try {
    const src = await loadProjectFacts(projectId)
    if (!src) return { fresh: false, hasBrief: false, baseDate: null }
    const facts = buildBriefFacts(src)
    const row = await getAiBrief(projectId, 'weekly', facts.todayWbs)
    return {
      fresh: !!row && row.inputHash === briefFactsHash(facts) && row.status === 'ready',
      hasBrief: !!row,
      baseDate: facts.todayWbs,
    }
  } catch (e) {
    console.error('[brief] getProjectBriefAction 실패:', e instanceof Error ? e.message : e)
    return { fresh: false, hasBrief: false, baseDate: null }
  }
}
