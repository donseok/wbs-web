import { ListChecks, Activity, Gauge } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { collectLeaves } from '@/components/wbs/shared'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { DEMO } from '@/lib/demo'

export default async function KanbanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, today }, m, projects] = await Promise.all([
    getComputedWbs(projectId),
    getMembership(),
    listProjects(),
  ])

  const project = projects.find((p: { id: string }) => p.id === projectId)
  const name = project?.name ?? '프로젝트'

  const leaves = collectLeaves(items)
  const total = leaves.length
  const inProgress = leaves.filter(leaf => leaf.status === 'in_progress').length
  const overall = items.length
    ? Math.round(items.reduce((sum, root) => sum + root.rolledActualPct, 0) / items.length)
    : 0

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="KANBAN BOARD"
        title={`${name} 칸반 보드`}
        description="작업을 Phase·담당자·상태별로 한눈에 관리하세요."
        aside={
          <>
            <KpiCard label="전체 작업" value={total} sub="말단 작업 카드" icon={ListChecks} />
            <KpiCard label="진행중" value={inProgress} sub={`전체 ${total}건 중`} icon={Activity} tone="brand" />
            <KpiCard label="전체 진척률" value={`${overall}%`} sub="Phase 평균 실적" icon={Gauge} tone="success" />
          </>
        }
      />
      <KanbanBoard items={items} membership={m} today={today} readOnly={DEMO} />
    </div>
  )
}
