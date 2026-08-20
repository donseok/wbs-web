import { getDisplayName } from '@/lib/auth'
import { getActorViewState } from '@/lib/authz'
import { isAnyProjectAdmin, hasAnyProjectRole } from '@/lib/domain/authz'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import { listProjectsWithState } from '@/app/actions/project'
import { Sidebar, type SidebarProject } from '@/components/app/Sidebar'
import { HeaderChrome } from '@/components/app/HeaderChrome'
import { DegradedNotice } from '@/components/app/DegradedNotice'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { DkBot } from '@/components/chat/DkBot'
import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { PrefsSync } from '@/components/app/PrefsSync'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'
import { UsageTracker } from '@/components/app/UsageTracker'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import { teamsSync } from '@/lib/teams/master'
import { projectLifecycleStatus } from '@/lib/domain/project-status'
import { getProjectsCompletion } from '@/lib/data/wbs'
import { getUiPrefs } from '@/app/actions/preferences'
import { seoulToday } from '@/lib/domain/dates'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 다섯 조회 전부 상호 독립 — 한 배치로 병렬 실행한다. getProjectsCompletion 은 무인자라
  // 프로젝트 목록을 기다릴 필요가 없다(2026-08-18 성능 감사: 종전엔 직렬 2단째였다).
  const [actorState, projectState, userName, prefs, completion] = await Promise.all([
    getActorViewState(),
    listProjectsWithState(),
    getDisplayName(),
    getUiPrefs(),
    getProjectsCompletion(),
  ])
  const actor = actorState.actor
  const projects = projectState.projects
  // 권한이나 프로젝트 목록을 못 읽었다 = 화면이 사실과 다르다. 이 상태를 정상인 척 그리면
  // 2026-08-05 처럼 REST 장애가 '로그인 실패'로 신고된다(에러 처리 3원칙 ① 표시 = 로깅).
  // 표시는 DegradedNotice 가 맡는다(아래 main 선두).
  const today = seoulToday()
  const projectLinks: SidebarProject[] = projects.map(p => ({
    id: p.id,
    name: p.name,
    status: projectLifecycleStatus(
      p.start_date, p.end_date, today,
      // completion === null 은 조회 실패(상태 모름) — 'WBS 없음'으로 뭉개면 '완료'로 오표시된다
      completion === null ? null : (completion[p.id] ?? { hasWbs: false, allDone: false }),
    ),
    baseDate: (p as { base_date?: string | null }).base_date ?? null,
  }))

  // 활성 팀만 클라이언트로 — 비활성 팀은 탭·필터에서 숨긴다(전체 목록이 필요한 화면은 서버에서 별도 주입).
  const activeTeams = teamsSync().filter(t => t.active)

  // Actor(Map)는 직렬화되지 않는다 — 헤더·사이드바가 쓸 표시용 스냅샷만 평탄화해 내린다.
  // degraded 면 등급을 **주장하지 않는다**. 여기서 '게스트'로 떨어뜨리면 화면이 거짓말을 한다.
  const identity = actor
    ? {
        roleLabel: actor.isSuperuser ? '슈퍼유저'
          : isAnyProjectAdmin(actor) ? '관리자'
            : hasAnyProjectRole(actor) ? '멤버' : '조회',
        teamCode: actor.teamCode,
        isSuperuser: actor.isSuperuser,
        showUsage: canViewUsage(actor),
        showPortfolio: canViewPortfolio(actor),
      }
    : actorState.degraded
      ? {
          roleLabel: '확인 불가',
          teamCode: null,
          isSuperuser: false,
          showUsage: false,
          showPortfolio: false,
        }
      : null

  return (
    <TeamsProvider teams={activeTeams}>
      <BotPageContextProvider>
        <ProjectNavigationProvider
          projects={projectLinks}
          initialLastProjectId={prefs.lastProjectId}
        >
          <ShellStateProvider>
          <div className="app-backdrop flex h-dvh overflow-hidden">
            <PrefsSync server={prefs} />
            <UsageTracker />
            {process.env.STAGING === "1" && (
              <div className="pointer-events-none fixed bottom-3 right-3 z-[300] rounded-md bg-amber-500/90 px-2.5 py-1 text-xs font-bold tracking-wider text-white shadow-lg">
                STAGING
              </div>
            )}
            <a href="#main-content" className="fixed left-4 top-3 z-[200] -translate-y-20 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition focus:translate-y-0">본문 바로가기</a>
            <Sidebar projects={projectLinks} showUsage={identity?.showUsage ?? false} showPortfolio={identity?.showPortfolio ?? false} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <HeaderChrome identity={identity} projects={projectLinks} userName={userName} />
              <main id="main-content" className="min-h-0 w-full flex-1 overflow-y-auto px-3 pb-4 pt-3 sm:px-5 lg:px-7">
                <DegradedNotice
                  actorFailed={actorState.degraded}
                  projectsFailed={projectState.degraded}
                />
                {children}
              </main>
            </div>
            <DkBot projects={projectLinks.map(p => ({ id: p.id, name: p.name }))} />
          </div>
          </ShellStateProvider>
        </ProjectNavigationProvider>
      </BotPageContextProvider>
    </TeamsProvider>
  )
}
