import { notFound, redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { getProjectOffice } from '@/lib/data/agentSeatmap'
import { PageHero } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { AgentTabs } from '@/components/agent-hub/AgentTabs'
import { SeatmapView } from '@/components/agents/SeatmapView'

export const dynamic = 'force-dynamic' // 좌석은 항상 최신이어야 한다

/**
 * 프로젝트 가상 오피스 — 이 프로젝트 층 하나를 전역 좌석표와 같은 규칙·폴링으로 그린다(2026-09-14 오피스 분리 스펙 §6-3).
 * 멤버 이상만 — 허브와 같은 게이트. 로더가 접근 범위와 다시 교집합을 낸다.
 */
export default async function ProjectOfficePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 오피스로 위장하지 않는다.
  const office = await getProjectOffice(actor, projectId)
  if (office.projectName === null) notFound()
  return (
    <ProjectPageShell
      hero={<PageHero eyebrow="AGENTS" title={`${office.projectName} 가상 오피스`} description="이 프로젝트 층의 좌석을 30초마다 갱신합니다." />}
      pinned={<AgentTabs projectId={projectId} />}>
      <SeatmapView initial={office.seatmap} projectId={projectId} />
    </ProjectPageShell>
  )
}
