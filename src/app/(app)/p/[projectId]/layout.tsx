import { ProjectTabs } from '@/components/app/ProjectTabs'
import { ProjectHero } from '@/components/wbs/ProjectHero'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const base = `/p/${projectId}`
  const [{ items }, projects] = await Promise.all([getComputedWbs(projectId), listProjects()])
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? 'WBS 프로젝트'

  return (
    <div className="space-y-5">
      <ProjectHero projectName={projectName} items={items} />
      <ProjectTabs base={base} />
      {children}
    </div>
  )
}
