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
  type ProjectAnalysis,
  type ProjectSummary,
} from './analytics'
import type { ChatIntent } from './intent'
import type { ProjectMember } from '@/lib/domain/types'

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
  text: string
  scopeProjectId: string | null
}

/** 의도 + 프로젝트 컨텍스트 → 구조화 사실/답변 문장(LLM 근거 또는 결정형 답변). */
export async function gatherKnowledge(intent: ChatIntent, projectId: string | null): Promise<Knowledge> {
  // 전사 의도이거나 현재 선택된 프로젝트가 없으면 전체 프로젝트 요약을 컨텍스트로.
  if (intent === 'overview' || !projectId) {
    const { summaries, excludedCount } = await allProjectSummaries()
    return { text: answerOverview(summaries, excludedCount), scopeProjectId: null }
  }

  const { analysis, members } = await loadProjectAnalysis(projectId)
  switch (intent) {
    case 'delayed':
      return { text: answerDelayed(analysis), scopeProjectId: projectId }
    case 'completed':
      return { text: answerCompleted(analysis), scopeProjectId: projectId }
    case 'this_week':
      return { text: answerThisWeek(analysis), scopeProjectId: projectId }
    case 'this_week_start':
      return { text: answerThisWeekStart(analysis), scopeProjectId: projectId }
    case 'by_team':
      return { text: answerByTeam(analysis, members), scopeProjectId: projectId }
    case 'weekly_summary':
      return { text: answerWeeklySummary(analysis), scopeProjectId: projectId }
    case 'project_status':
    case 'freeform':
    default:
      // freeform 은 의미검색이 디테일을 보강하고, 여기선 프로젝트 스냅샷을 기본 사실로 제공.
      return { text: answerProjectStatus(analysis), scopeProjectId: projectId }
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
