import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { PageHero } from '@/components/ui/PageHero'
import { SeatmapView } from '@/components/agents/SeatmapView'

export const dynamic = 'force-dynamic' // 좌석표는 항상 최신이어야 한다

export default async function AgentsPage() {
  // 슈퍼유저 또는 역할이 있는 프로젝트 1개 이상 — 판정은 canViewAgents 한 곳. 입구는 프로젝트 가상 오피스 탭의 "전체 오피스" 링크(사이드바 항목 없음).
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) redirect('/projects')
  // 조회 실패는 throw → Next 의 error 경계가 받는다. 빈 좌석표로 위장하지 않는다.
  const seatmap = await getSeatmap(actor) // 기본은 내 작업(scope=mine); 화면에서 전체로 바꿀 수 있다
  return (
    <div className="space-y-4">
      <PageHero eyebrow="OPERATIONS" title="가상 오피스 · 전체" />
      {/*
       * 돌아갈 길 — 이 화면은 사이드바 항목도 프로젝트 탭(AgentTabs)도 없다. 프로젝트 오피스의
       * "전체 오피스" 링크로 들어오면 브라우저 뒤로 가기 말고는 나갈 방법이 없었다.
       * 층 = 이 사람이 볼 수 있는, 지금 좌석이 있는 프로젝트다. 층이 없을 때를 위해 목록 링크도 늘 둔다.
       */}
      <nav aria-label="다른 오피스" className="flex flex-wrap items-center gap-2">
        <span data-office-nav="all" aria-current="page" className="chip bg-brand-weak text-brand">전체 오피스</span>
        {seatmap.floors.map(f => (
          <Link key={f.id} href={`/p/${f.id}/agents/office`} data-office-nav={f.id}
            title={`${f.name} 의 가상 오피스로 — 거기서 위임·승인 탭으로 갈 수 있습니다`}
            className="chip bg-surface-2 text-ink-muted hover:text-ink">{f.name}</Link>
        ))}
        <Link href="/projects" data-office-nav="projects" className="chip text-ink-subtle hover:text-ink">프로젝트 목록</Link>
      </nav>
      <SeatmapView initial={seatmap} />
    </div>
  )
}
