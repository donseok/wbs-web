import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { Sidebar, type SidebarProject } from '@/components/app/Sidebar'
import { HeaderChrome } from '@/components/app/HeaderChrome'

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
  }))

  return (
    <div className="app-backdrop flex min-h-screen">
      <a href="#main-content" className="fixed left-4 top-3 z-[200] -translate-y-20 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition focus:translate-y-0">본문 바로가기</a>
      <Sidebar projects={projectLinks} />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderChrome membership={m} projects={projectLinks} />
        <main id="main-content" className="mx-auto w-full max-w-[1680px] flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-7">{children}</main>
      </div>
    </div>
  )
}
