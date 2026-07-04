import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { Sidebar, type SidebarProject } from '@/components/app/Sidebar'
import { HeaderChrome } from '@/components/app/HeaderChrome'
import { DkBot } from '@/components/chat/DkBot'
import { PrefsSync } from '@/components/app/PrefsSync'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function projectStatus(start: string | null, end: string | null, today: string): SidebarProject['status'] {
  if (!start || !end) return 'ready'
  if (today < start) return 'ready'
  if (today > end) return 'done'
  return 'active'
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [m, projects] = await Promise.all([getMembership(), listProjects()])
  const today = seoulToday()
  const projectLinks: SidebarProject[] = projects.map(p => ({
    id: p.id,
    name: p.name,
    status: projectStatus(p.start_date, p.end_date, today),
    baseDate: (p as { base_date?: string | null }).base_date ?? null,
  }))

  return (
    <div className="app-backdrop flex h-dvh overflow-hidden">
      <PrefsSync />
      <a href="#main-content" className="fixed left-4 top-3 z-[200] -translate-y-20 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition focus:translate-y-0">본문 바로가기</a>
      <Sidebar projects={projectLinks} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HeaderChrome membership={m} projects={projectLinks} />
        <main id="main-content" className="mx-auto min-h-0 w-full max-w-[1680px] flex-1 overflow-y-auto px-3 pb-4 pt-4 sm:px-5 sm:pt-6 lg:px-7">{children}</main>
      </div>
      <DkBot projects={projectLinks.map(p => ({ id: p.id, name: p.name }))} />
    </div>
  )
}
