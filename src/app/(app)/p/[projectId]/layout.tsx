import { TeamsProvider } from '@/components/app/TeamsProvider'
import { teamsForProjectSync } from '@/lib/teams/master'

// 프로젝트 셸. 메뉴는 사이드바로 이동했고, 각 페이지가 자체 PageHero 를 렌더한다.
// TeamsProvider 중첩(안쪽 승리)으로 /p/ 하위의 useTeams/useTeamCodes 가 프로젝트 팀을 받는다 —
// 전역 화면(회의록·계정)은 (app)/layout 의 전역 Provider 그대로(스펙 §2).
export default async function ProjectLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const teams = teamsForProjectSync(projectId).filter(t => t.active)
  return (
    <TeamsProvider teams={teams}>
      <div className="h-full min-h-0 min-w-0">{children}</div>
    </TeamsProvider>
  )
}
