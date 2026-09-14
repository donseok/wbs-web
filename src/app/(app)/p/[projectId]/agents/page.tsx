import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { getAgentHub } from '@/lib/data/agentHub'
import { PageHero } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { AgentHubView } from '@/components/agent-hub/AgentHubView'

export const dynamic = 'force-dynamic' // 위임·주문 상태는 항상 최신이어야 한다

/**
 * 프로젝트 에이전트 허브 — 켜기/중지·위임(단건·일괄)·프롬프트·승인·좌석 층을 한 화면에(2026-09-14 허브 스펙).
 * 멤버 이상만 — 조회 전용은 대시보드로. 판정은 isProjectMember 한 곳(사이드바는 프로젝트 목록 자체가 멤버 기준).
 */
export default async function ProjectAgentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 허브로 위장하지 않는다.
  const hub = await getAgentHub(projectId, { userId: actor.userId, isAdmin: isProjectAdmin(actor, projectId) })
  return (
    <ProjectPageShell hero={<PageHero eyebrow="AGENTS" title={`${hub.projectName} 에이전트`} description="위임·승인·좌석을 한곳에서 봅니다." />}>
      <AgentHubView initial={hub} />
    </ProjectPageShell>
  )
}
