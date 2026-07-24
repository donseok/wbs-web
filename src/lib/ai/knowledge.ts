import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { listProjects } from '@/app/actions/project'
import {
  analyzeProject,
  summarizeProject,
  answerProjectStatus,
  answerDelayed,
  answerCompleted,
  answerThisWeek,
  answerThisWeekStart,
  answerByTeam,
  answerWeeklySummary,
  answerOverview,
  buildFactSheet,
  keywordMatchLines,
  type ProjectAnalysis,
  type ProjectSummary,
} from './analytics'
import { extractSearchKeywords, type ChatIntent } from './intent'
import type { ProjectMember } from '@/lib/domain/types'
import { activeTeamCodesSync } from '@/lib/teams/master'

export const getProjectName = cache(async (projectId: string): Promise<string> => {
  const sb = await createServerClient()
  const { data } = await sb.from('projects').select('name').eq('id', projectId).maybeSingle()
  return (data as { name?: string } | null)?.name ?? '프로젝트'
})

export interface LoadedProject {
  analysis: ProjectAnalysis
  members: ProjectMember[]
  name: string
}

export const loadProjectAnalysis = cache(async (projectId: string): Promise<LoadedProject> => {
  const [{ items, today }, members, name] = await Promise.all([
    getComputedWbs(projectId),
    getProjectMembers(projectId),
    getProjectName(projectId),
  ])
  return { analysis: analyzeProject(items, name, today, members), members, name }
})

async function allProjectSummaries(): Promise<{ summaries: ProjectSummary[]; excludedCount: number }> {
  const projects = (await listProjects()) as { id: string; name: string }[]
  const results = await Promise.all(
    projects.map(async p => {
      try {
        const { items, today } = await getComputedWbs(p.id)
        return summarizeProject(analyzeProject(items, p.name, today))
      } catch (e) {
        console.error(`[dkbot] 전사 요약 — 프로젝트 "${p.name}" 분석 실패(제외):`, e instanceof Error ? e.message : e)
        return null
      }
    }),
  )
  const summaries = results.filter((s): s is ProjectSummary => s !== null)
  return { summaries, excludedCount: results.length - summaries.length }
}

export interface Knowledge {
  /** 사용자에게 그대로 보여줄 결정형 답변(LLM 미설정/실패 시 폴백). 간결하게 유지. */
  text: string
  /** LLM 근거용 사실 블록. 탐색형 질문(freeform/project_status)엔 전체 작업 팩트시트를 더해 준다. */
  facts: string
  scopeProjectId: string | null
  /**
   * "X 가 들어간 항목" 류 검색 질문에서 추출한 키워드와 정확 일치 작업 목록(팩트시트 형식).
   * total=0 도 의미 있는 정보(해당 키워드 없음 → LLM/결정형 답변이 환각 없이 '없음'을 답함).
   * freeform + 키워드 감지 + 프로젝트 스코프일 때만 채워진다.
   */
  keywordHits?: { keywords: string[]; total: number; lines: string[] }
}

/** 의도 + 프로젝트 컨텍스트 → 구조화 사실/답변 문장(LLM 근거 또는 결정형 답변).
 *  message 는 freeform 키워드 검색 감지에만 쓰인다(생략 시 감지 안 함). */
export async function gatherKnowledge(intent: ChatIntent, projectId: string | null, message = ''): Promise<Knowledge> {
  // 전사 의도이거나 현재 선택된 프로젝트가 없으면 전체 프로젝트 요약을 컨텍스트로.
  if (intent === 'overview' || !projectId) {
    const { summaries, excludedCount } = await allProjectSummaries()
    const text = answerOverview(summaries, excludedCount)
    return { text, facts: text, scopeProjectId: null }
  }

  const { analysis, members } = await loadProjectAnalysis(projectId)
  const only = (text: string): Knowledge => ({ text, facts: text, scopeProjectId: projectId })
  switch (intent) {
    case 'delayed':
      return only(answerDelayed(analysis))
    case 'completed':
      return only(answerCompleted(analysis))
    case 'this_week':
      return only(answerThisWeek(analysis))
    case 'this_week_start':
      return only(answerThisWeekStart(analysis))
    case 'by_team':
      return only(answerByTeam(analysis, members, activeTeamCodesSync()))
    case 'weekly_summary':
      return only(answerWeeklySummary(analysis))
    case 'project_status':
    case 'freeform':
    default: {
      // 탐색형: 사용자 폴백은 간결한 스냅샷, LLM 근거엔 전체 작업 팩트시트를 더해
      // 구체 질문(담당/일정/진행률 등)에 정확히 답하게 한다. 의미검색이 산출물/업무 상세를 추가 보강.
      const text = answerProjectStatus(analysis)
      const keywords = intent === 'freeform' ? extractSearchKeywords(message) : []
      const hits = keywords.length ? keywordMatchLines(analysis, keywords) : null
      return {
        text,
        facts: `${text}\n\n${buildFactSheet(analysis)}`,
        scopeProjectId: projectId,
        keywordHits: hits ? { keywords, total: hits.total, lines: hits.lines } : undefined,
      }
    }
  }
}

export interface BotContext {
  currentProject: { id: string; name: string; taskCount: number; donePct: number } | null
  totalProjects: number
  weekStartCount: number
}

/** 패널 부트스트랩 — 환영 메시지/프로액티브 인사이트 렌더용 컨텍스트. */
export async function buildBotContext(projectId: string | null): Promise<BotContext> {
  const projects = await listProjects()
  const totalProjects = projects.length
  if (!projectId) return { currentProject: null, totalProjects, weekStartCount: 0 }
  try {
    const { analysis, name } = await loadProjectAnalysis(projectId)
    return {
      currentProject: { id: projectId, name, taskCount: analysis.taskCount, donePct: analysis.donePct },
      totalProjects,
      weekStartCount: analysis.startingThisWeek.length,
    }
  } catch {
    return { currentProject: null, totalProjects, weekStartCount: 0 }
  }
}
