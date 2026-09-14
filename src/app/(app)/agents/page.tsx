import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { PageHero } from '@/components/ui/PageHero'
import { SeatmapView } from '@/components/agents/SeatmapView'

export const dynamic = 'force-dynamic' // 좌석표는 항상 최신이어야 한다

export default async function AgentsPage() {
  // 슈퍼유저 또는 역할이 있는 프로젝트 1개 이상 — 판정은 canViewAgents 한 곳. 입구는 프로젝트 에이전트 허브의 "전체 좌석표" 링크(사이드바 항목 없음).
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) redirect('/projects')
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 좌석표로 위장하지 않는다.
  const seatmap = await getSeatmap(actor) // 기본은 내 작업(scope=mine); 화면에서 전체로 바꿀 수 있다
  return (
    <div className="space-y-4">
      <PageHero eyebrow="OPERATIONS" title="에이전트 좌석표" />
      <SeatmapView initial={seatmap} />
    </div>
  )
}
