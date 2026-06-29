import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { Sidebar } from '@/components/app/Sidebar'
import { HeaderChrome } from '@/components/app/HeaderChrome'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [m, projects] = await Promise.all([getMembership(), listProjects()])
  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar projects={projects.map(p => ({ id: p.id, name: p.name }))} />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderChrome membership={m} />
        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-5 py-6">{children}</main>
      </div>
    </div>
  )
}
