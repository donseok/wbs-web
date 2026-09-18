import { ListChecks, Activity, Gauge } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { getActorForView } from '@/lib/authz'
import { toProjectActorView } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { collectLeaves } from '@/components/wbs/shared'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { WbsRealtimeRefresh } from '@/components/wbs/WbsRealtimeRefresh'

export default async function KanbanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [{ items, today }, actor, projects, locale] = await Promise.all([
    getComputedWbs(projectId),
    getActorForView(),
    listProjects(),
    getServerLocale(),
  ])

  const project = projects.find((p: { id: string }) => p.id === projectId)
  const name = project?.name ?? t(locale, 'kanban.projectFallback')

  const leaves = collectLeaves(items)
  const total = leaves.length
  const inProgress = leaves.filter(leaf => leaf.status === 'in_progress').length
  const overall = items.length
    ? Math.round(items.reduce((sum, root) => sum + root.rolledActualPct, 0) / items.length)
    : 0

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="KANBAN BOARD"
        title={`${name} ${t(locale, 'kanban.heroTitleSuffix')}`}
        description={t(locale, 'kanban.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label={t(locale, 'kanban.kpiTotalTasks')} value={total} sub={t(locale, 'kanban.kpiTotalTasksSub')} icon={ListChecks} />
            <KpiCard variant="hero" label={t(locale, 'status.in_progress')} value={inProgress} sub={`${t(locale, 'kanban.kpiOfTotalPrefix')}${total}${t(locale, 'kanban.kpiOfTotalSuffix')}`} icon={Activity} tone="brand" />
            <KpiCard variant="hero" label={t(locale, 'kanban.kpiOverallProgress')} value={`${overall}%`} sub={t(locale, 'kanban.kpiOverallProgressSub')} icon={Gauge} tone="success" />
          </>
        }
      />}
    >
      {/* 실시간(0098) — 에이전트 done 보고가 단계를 im 으로 올리면 카드가 새로고침 없이 옮겨 가야 한다
          (2026-09-18 사용자 보고: "다시 조회해야 바뀐다"). 카드 열·KPI 는 롤업 집계라 페이로드로 패치할 수
          없어 재조회한다. 대시보드(10초)보다 짧게 잡는 이유: 카드를 보며 조작하는 화면이고 보는 사람이 소수다. */}
      <WbsRealtimeRefresh projectId={projectId} delayMs={1_500} maxWaitMs={5_000} jitterMs={3_000} />
      <KanbanBoard projectId={projectId} items={items} actorView={toProjectActorView(actor, projectId)} today={today} />
    </ProjectPageShell>
  )
}
