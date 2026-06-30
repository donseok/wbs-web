import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { PageHero } from '@/components/ui/PageHero'

type ProjectRow = { id: string; name: string }

export default async function WbsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { projectId } = await params
  const { view } = await searchParams
  const [{ items, holidays, today }, m, projects] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
    listProjects(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="WBS · GANTT"
        title={`${project?.name ?? '프로젝트'} WBS · 간트`}
        description="계획·실적·가중 롤업을 한 시트에서 관리하고, ‘타임라인 집중’으로 간트만 크게 볼 수 있습니다."
      />
      <WbsGanttSheet
        items={items}
        holidays={holidays}
        today={today}
        membership={m}
        projectId={projectId}
        defaultView={view === 'timeline' ? 'timeline' : 'sheet'}
      />
    </div>
  )
}
