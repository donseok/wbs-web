import { notFound, redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { getProjectOffice } from '@/lib/data/agentSeatmap'
import { UUID_RE } from '@/lib/domain/validate'
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
  // 형식이 아닌 값은 DB 까지 가면 uuid 비교에서 throw 해 500 이 된다 — 슈퍼유저는 멤버 판정을 통과하므로 여기서 404 로 끊는다.
  if (!UUID_RE.test(projectId)) notFound()
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 오피스로 위장하지 않는다.
  const office = await getProjectOffice(actor, projectId, Date.now(), 'all') // 기본은 전체(2026-09-19)
  if (office.projectName === null) notFound()
  // 공통 헤더(탭·요약·타일)는 뷰가 그린다 — 타일이 30초 폴링을 따라가야 한다(AgentFrame).
  return <SeatmapView initial={office.seatmap} projectId={projectId} projectName={office.projectName} />
}
