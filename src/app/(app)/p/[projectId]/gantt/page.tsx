import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { GanttView } from '@/components/gantt/GanttView'
import { PageHero } from '@/components/ui/PageHero'

type ProjectRow = { id: string; name: string }

// 간트는 WBS와 데이터를 공유하지만(통합 시트는 /wbs), 이 화면은 타임라인 중심의 전용 뷰다.
export default async function GanttPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, holidays, today }, projects] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="GANTT"
        title={`${project?.name ?? '프로젝트'} 간트 차트`}
        description="계획 일정과 실적 진행을 타임라인으로 한눈에 봅니다. 상세 편집은 WBS 화면에서."
      />
      <GanttView items={items} holidays={holidays} today={today} />
    </div>
  )
}
