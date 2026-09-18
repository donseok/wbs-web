import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember, toProjectActorView } from '@/lib/domain/authz'
import { getAgentHub } from '@/lib/data/agentHub'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { getProjectMembers } from '@/lib/data/members'
import { AgentHubView } from '@/components/agent-hub/AgentHubView'

export const dynamic = 'force-dynamic' // 위임·주문 상태는 항상 최신이어야 한다

/**
 * 프로젝트 에이전트 허브 — 켜기/중지·위임(단건·일괄)·프롬프트·승인을 한 화면에(좌석 층은 /agents/office, 2026-09-14 허브 스펙).
 * 멤버 이상만 — 조회 전용은 대시보드로. 판정은 isProjectMember 한 곳(사이드바는 프로젝트 목록 자체가 멤버 기준).
 * 이름 클릭 시 여는 WBS 상세 패널을 위해 계산된 WBS(getComputedWbs)·설정·로스터를 허브와 함께 병렬 로드해 넘긴다(2026-09-15).
 */
export default async function ProjectAgentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 허브로 위장하지 않는다.
  const [hub, wbsData, projectConfig, members] = await Promise.all([
    getAgentHub(projectId, { userId: actor.userId, isAdmin: isProjectAdmin(actor, projectId) }),
    getComputedWbs(projectId),
    getProjectConfig(projectId),
    getProjectMembers(projectId),
  ])
  const wbs = {
    items: wbsData.items,
    dependencies: wbsData.dependencies,
    unresolvedDepends: wbsData.unresolvedDepends,
    holidays: wbsData.holidays,
    today: wbsData.today,
    levelLabels: projectConfig.levelLabels,
    maxDepth: projectConfig.maxDepth,
    members,
    actorView: toProjectActorView(actor, projectId),
  }
  // 공통 헤더(탭·요약·타일)는 뷰가 그린다 — 타일이 뷰의 최신 허브 상태를 따라가야 한다(AgentFrame).
  return <AgentHubView initial={hub} wbs={wbs} />
}
