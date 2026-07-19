import { getMembership, getDisplayName } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { Sidebar, type SidebarProject } from '@/components/app/Sidebar'
import { HeaderChrome } from '@/components/app/HeaderChrome'
import { DkBot } from '@/components/chat/DkBot'
import { BotPageContextProvider } from '@/components/chat/BotPageContextProvider'
import { PrefsSync } from '@/components/app/PrefsSync'
import { projectLifecycleStatus } from '@/lib/domain/project-status'
import { getProjectsCompletion } from '@/lib/data/wbs'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [m, projects, userName] = await Promise.all([getMembership(), listProjects(), getDisplayName()])
  const today = seoulToday()
  const completion = await getProjectsCompletion(projects.map(p => p.id))
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

  return (
    <BotPageContextProvider>
      <div className="app-backdrop flex h-dvh overflow-hidden">
        <PrefsSync />
        <a href="#main-content" className="fixed left-4 top-3 z-[200] -translate-y-20 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition focus:translate-y-0">본문 바로가기</a>
        <Sidebar projects={projectLinks} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <HeaderChrome membership={m} projects={projectLinks} userName={userName} />
          <main id="main-content" className="min-h-0 w-full flex-1 overflow-y-auto px-3 pb-4 pt-4 sm:px-5 sm:pt-6 lg:px-7">{children}</main>
        </div>
        <DkBot projects={projectLinks.map(p => ({ id: p.id, name: p.name }))} />
      </div>
    </BotPageContextProvider>
  )
}
