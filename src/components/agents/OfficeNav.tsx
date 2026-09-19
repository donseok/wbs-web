'use client'
// 전체 스튜디오(/agents)의 헤더 내비게이션 — 프로젝트 화면의 위임·승인|에이전트 스튜디오 탭 자리에 얹는다(2026-09-18).
// 이 화면은 사이드바 항목도 프로젝트 탭도 없어서, 여기가 유일한 돌아갈 길이다. 층 = 지금 좌석이 있는 프로젝트,
// 층이 없을 때를 위해 프로젝트 목록 링크를 늘 둔다.
import Link from 'next/link'
import { TAB_TONE, type TabTone } from '@/components/agent-hub/AgentTabs'

export function OfficeNav({ floors, tone }: { floors: ReadonlyArray<{ id: string; name: string }>; tone: TabTone }) {
  const t = TAB_TONE[tone]
  return (
    <nav aria-label="다른 스튜디오" className="flex flex-wrap items-center gap-1.5">
      <span data-office-nav="all" aria-current="page" className={`chip ${t.on}`}>전체 스튜디오</span>
      {floors.map(f => (
        <Link key={f.id} href={`/p/${f.id}/agents/office`} data-office-nav={f.id}
          title={`${f.name} 의 에이전트 스튜디오로 — 거기서 위임·승인 탭으로 갈 수 있습니다`}
          className={`chip ${t.off}`}>{f.name}</Link>
      ))}
      <Link href="/projects" data-office-nav="projects" className={`chip ${t.off}`}>프로젝트 목록</Link>
    </nav>
  )
}
