import { notFound, redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { getProjectOffice } from '@/lib/data/agentSeatmap'
import { UUID_RE } from '@/lib/domain/validate'
import { RosterView } from '@/components/agent-roster/RosterView'

export const dynamic = 'force-dynamic' // 자리 상태는 항상 최신이어야 한다

/**
 * 프로젝트 에이전트 명부 — 좌석표(주문 기준)를 작업 PC·자리 기준으로 다시 묶어 보인다(2026-09-18 시안 v2).
 * 게이트·로더는 가상 오피스와 같다. 명부는 누가 어디서 일하는지 보는 화면이라 범위는 늘 전체(all)다.
 */
export default async function ProjectAgentRosterPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const actor = await getActorForView()
  if (!actor || !isProjectMember(actor, projectId)) redirect(`/p/${projectId}/dashboard`)
  // 형식이 아닌 값은 DB 까지 가면 uuid 비교에서 throw 해 500 이 된다 — 오피스와 같이 여기서 404 로 끊는다.
  if (!UUID_RE.test(projectId)) notFound()
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 명부로 위장하지 않는다.
  const office = await getProjectOffice(actor, projectId, Date.now(), 'all')
  if (office.projectName === null) notFound()
  return <RosterView initial={office.seatmap} projectId={projectId} projectName={office.projectName} />
}
