import { listProjects } from '@/app/actions/project'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { getWeeklySheet, findCarryOverSource } from '@/lib/data/weeklySheet'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function WeeklyPage({
  params, searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { projectId } = await params
  const { week } = await searchParams
  const weekStart = mondayIso(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : seoulToday())
  const wk = sheetWeekMeta(weekStart)

  const [sheet, carrySource, projects] = await Promise.all([
    getWeeklySheet(projectId, weekStart),
    findCarryOverSource(projectId, weekStart),
    listProjects(),
  ])
  const projectName = projects.find(p => p.id === projectId)?.name ?? ''

  // TODO(Task 10): nav.weekly i18n 키 추가 후 t(locale, 'nav.weekly')로 교체
  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="WEEKLY"
        badge={<HeroBadge>Weekly Report</HeroBadge>}
        title={`${projectName} 주간업무`}
        description={`${wk.label} (${wk.thisRange})`}
      />}
    >
      <WeeklySheetView
        projectId={projectId}
        weekStart={weekStart}
        weekLabel={`${wk.label} (${wk.thisRange})`}
        report={sheet ? { id: sheet.report.id } : null}
        initialRows={sheet?.rows ?? []}
        hasCarrySource={!!carrySource && carrySource.rows.length > 0}
      />
    </ProjectPageShell>
  )
}
