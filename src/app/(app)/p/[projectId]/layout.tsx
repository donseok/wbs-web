import { ProjectTabs } from '@/components/app/ProjectTabs'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const base = `/p/${projectId}`
  return (
    <div className="space-y-5">
      <ProjectTabs base={base} />
      {children}
    </div>
  )
}
