import { listProjects } from '@/app/actions/project'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { getWeeklySheet, findCarryOverSource } from '@/lib/data/weeklySheet'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
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

  const [sheet, carrySource, projects, locale] = await Promise.all([
    getWeeklySheet(projectId, weekStart),
    findCarryOverSource(projectId, weekStart),
    listProjects(),
    getServerLocale(),
  ])
  const projectName = projects.find(p => p.id === projectId)?.name ?? ''

  return (
    <ProjectPageShell
      // 이 화면은 구글시트 복제 룩이 주인공 — 큰 히어로 대신 콤팩트한 한 줄 헤더만 둔다(사용자 요청).
      hero={
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">WEEKLY</span>
          <h1 className="text-lg font-bold tracking-tight text-ink">{projectName} {t(locale, 'nav.weekly')}</h1>
        </div>
      }
    >
      <WeeklySheetView
        projectId={projectId}
        weekStart={weekStart}
        weekLabel={`${wk.label} (${wk.thisRange})`}
        weekTitle={wk.label}
        thisRange={wk.thisRange}
        nextRange={wk.nextRange}
        projectName={projectName}
        report={sheet ? { id: sheet.report.id } : null}
        initialRows={sheet?.rows ?? []}
        hasCarrySource={!!carrySource && carrySource.rows.length > 0}
      />
    </ProjectPageShell>
  )
}
