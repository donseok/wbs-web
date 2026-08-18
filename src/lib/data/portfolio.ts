import { createServerClient } from '@/lib/supabase/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { listProjectsWithState } from '@/app/actions/project'
import { seoulToday } from '@/lib/domain/dates'
import type { PortfolioProjectInput } from '@/lib/domain/portfolio'
import { getActor } from '@/lib/authz'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import type { ProjectMemberRole } from '@/lib/domain/types'

/**
 * 포트폴리오 입력 일괄 로드 — 프로젝트 N개를 병렬로 읽는다(/projects 홈과 같은 패턴).
 * 개별 프로젝트 실패는 그 행만 degraded(items null)로 격리한다 — 한 프로젝트 장애로
 * 전사 화면을 죽이지 않되, 실패를 '데이터 없음'으로 위장하지 않는다(3원칙).
 * 호출 전제: canViewPortfolio 통과(슈퍼유저) — listProjectsWithState 의 canSeeProject 는
 * 슈퍼유저에게 비공개(0070) 포함 전체를 반환한다.
 */
export async function getPortfolioInputs(): Promise<{
  inputs: PortfolioProjectInput[]
  leadersDegraded: boolean
  listDegraded: boolean
}> {
  // 페이지의 redirect 는 UX 일 뿐 — 실제 방어선은 이 재검사다(getUsageDirectory 선례).
  if (!canViewPortfolio(await getActor())) {
    throw new Error('portfolio: 슈퍼유저 전용 조회입니다.')
  }
  const { projects, degraded: listDegraded } = await listProjectsWithState()
  const ids = projects.map(p => p.id)

  // PM(리더) = project_members.role='admin' — IN 한 방(getProjectsCompletion 선례).
  // 표시 전용이라 실패해도 throw 하지 않지만, '리더 없음'으로 위장하지 않도록 플래그로 신호한다.
  const sb = await createServerClient()
  let leadersDegraded = false
  const leadersByProject = new Map<string, string[]>()
  if (ids.length) {
    const { data, error } = await sb
      .from('project_members')
      .select('project_id, name')
      .eq('role', 'admin' satisfies ProjectMemberRole)
      .in('project_id', ids)
      .order('name')
    if (error) {
      console.error('[portfolio] 리더 조회 실패:', error.message)
      leadersDegraded = true
    }
    for (const r of data ?? []) {
      const arr = leadersByProject.get(r.project_id as string) ?? []
      arr.push(r.name as string)
      leadersByProject.set(r.project_id as string, arr)
    }
  }

  const inputs = await Promise.all(projects.map(async (p): Promise<PortfolioProjectInput> => {
    const row = p as typeof p & { base_date?: string | null; is_private?: boolean }
    const base = {
      projectId: p.id, name: p.name,
      isPrivate: row.is_private === true,
      startDate: p.start_date ?? null, endDate: p.end_date ?? null,
      baseDate: row.base_date ?? null,
      leaders: leadersByProject.get(p.id) ?? [],
    }
    try {
      const [wbs, config] = await Promise.all([getComputedWbs(p.id), getProjectConfig(p.id)])
      return { ...base, today: wbs.today, items: wbs.items, milestoneKeywords: config.milestoneKeywords }
    } catch (e) {
      console.error(`[portfolio] 프로젝트 로드 실패 — 행을 degraded 로 표시: ${p.name}(${p.id})`, e)
      return { ...base, today: seoulToday(), items: null, milestoneKeywords: [] }
    }
  }))

  return { inputs, leadersDegraded, listDegraded }
}
