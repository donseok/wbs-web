import Link from 'next/link'
import { FolderKanban, Activity, CircleCheck, Gauge, Calendar, FolderPlus, LayoutGrid, ArrowDown, History, ArrowRight } from 'lucide-react'
import { listProjects } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { getComputedWbs } from '@/lib/data/wbs'
import { aggregateTaskStats } from '@/lib/domain/workspace'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { KpiCard } from '@/components/ui/KpiCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { NewProjectModal } from '@/components/home/NewProjectModal'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import type { ComputedItem } from '@/lib/domain/types'

type ProjectRow = {
  id: string
  name: string
  description?: string | null
  start_date: string | null
  end_date: string | null
  created_at?: string | null
}

const STATUS: Record<ProjectLifecycleStatus, { labelKey: DictKey; chip: string; dot: string }> = {
  ready: { labelKey: 'home.status_ready', chip: 'bg-pending-weak text-pending', dot: 'bg-pending' },
  active: { labelKey: 'home.status_active', chip: 'bg-brand-weak text-brand', dot: 'bg-brand' },
  overdue: { labelKey: 'home.status_overdue' as DictKey, chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
  done: { labelKey: 'home.status_done', chip: 'bg-done-weak text-done', dot: 'bg-done' },
}

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '??'
  // 영문은 단어 첫 글자 2개, 그 외(한글 등)는 앞 2글자
  const ascii = /^[\x00-\x7F]+$/.test(trimmed)
  if (ascii) {
    const parts = trimmed.split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : trimmed.slice(0, 2)).toUpperCase()
  }
  return trimmed.slice(0, 2)
}

function dateRange(start: string | null, end: string | null, locale: Locale): string {
  if (!start && !end) return t(locale, 'home.scheduleUnset')
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

function ProjectCard({ project, status, locale }: { project: ProjectRow; status: ProjectLifecycleStatus; locale: Locale }) {
  const s = STATUS[status]
  return (
    <Link
      href={`/p/${project.id}/dashboard`}
      className="card group flex min-h-[184px] flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-[var(--shadow-md)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-[var(--shadow-sm)]"
          style={{ backgroundImage: 'var(--gradient-primary)' }}
        >
          {initials(project.name)}
        </span>
        <span className={`chip ${s.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {t(locale, s.labelKey)}
        </span>
      </div>

      <div className="mt-4 min-w-0">
        <h3 className="truncate text-[15px] font-semibold text-ink" title={project.name}>{project.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-ink-muted">
          {project.description?.trim() || t(locale, 'home.noDescription')}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-4 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink-subtle">
          <Calendar className="h-3.5 w-3.5" />
          <span className="tabular-nums">{dateRange(project.start_date, project.end_date, locale)}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-ink-subtle transition group-hover:text-brand">
          {t(locale, 'home.open')} <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}

export default async function ProjectsHome() {
  const [rawProjects, membership] = await Promise.all([listProjects(), getMembership()])
  const locale = await getServerLocale()
  const projects = rawProjects as ProjectRow[]
  const today = seoulToday()

  // 히어로 통계칩 = 전사 작업 집계(TASKS / DONE / %). 각 프로젝트의 WBS 트리를 병렬 로드해 리프를 합산한다.
  const trees = await Promise.all(
    projects.map(p => getComputedWbs(p.id).then(w => w.items).catch((): ComputedItem[] => [])),
  )
  const taskStats = aggregateTaskStats(trees)

  const withStatus = projects.map((p, i) => {
    const stats = aggregateTaskStats([trees[i]])
    return {
      project: p,
      status: projectLifecycleStatus(p.start_date, p.end_date, today, {
        hasWbs: stats.tasks > 0,
        allDone: stats.tasks > 0 && stats.done === stats.tasks,
      }),
    }
  })
  const total = withStatus.length
  const activeCount = withStatus.filter(x => x.status === 'active').length
  const doneCount = withStatus.filter(x => x.status === 'done').length
  const activeRatio = total ? Math.round((activeCount / total) * 100) : 0
  const recent = withStatus.slice(0, 3)
  const canCreate = membership?.role === 'pmo_admin'

  const heroStats = [
    { label: 'Tasks', value: taskStats.tasks },
    { label: 'Done', value: taskStats.done },
    { label: '%', value: `${taskStats.donePct}%` },
  ]

  return (
    <div className="space-y-6 pb-20">
      {/* ── 히어로 ── */}
      <section className="hero-glow hero-card flex flex-col gap-7 p-6 sm:p-8">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-hero-ink-muted">Workspace · D&apos;Flow</div>
          <h1 className="mt-2 break-words text-[26px] font-bold leading-tight tracking-tight text-hero-ink sm:text-[34px]">
            {t(locale, 'home.heroTitle')}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-hero-ink-muted">
            {t(locale, 'home.heroDesc')}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {heroStats.map(stat => (
              <span
                key={stat.label}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2 text-sm backdrop-blur"
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-hero-ink-muted">{stat.label}</span>
                <strong className="tabular-nums text-hero-ink">{stat.value}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate && <NewProjectModal />}
          <a
            href="#project-library"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20"
          >
            <LayoutGrid className="h-4 w-4" />
            {t(locale, 'nav.allProjects')}
            <ArrowDown className="h-3.5 w-3.5 opacity-70" />
          </a>
        </div>
      </section>

      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label={t(locale, 'nav.allProjects')} value={total} sub={t(locale, 'home.kpiTotalSub')} icon={FolderKanban} tone="brand" />
        <KpiCard label={t(locale, 'home.status_active')} value={activeCount} sub={t(locale, 'home.kpiActiveSub')} icon={Activity} tone="default" />
        <KpiCard label={t(locale, 'home.status_done')} value={doneCount} sub={t(locale, 'home.kpiDoneSub')} icon={CircleCheck} tone="success" />
        <KpiCard label="Active ratio" value={`${activeRatio}%`} sub={t(locale, 'home.kpiRatioSub')} icon={Gauge} tone="warning" />
      </div>

      {/* ── 최근 프로젝트 (QUICK ACCESS) ── */}
      {total > 3 && (
        <section aria-labelledby="recent-title">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-weak text-brand"><History className="h-4 w-4" /></span>
            <div>
              <div className="eyebrow">Quick access</div>
              <h2 id="recent-title" className="text-sm font-semibold text-ink">{t(locale, 'home.recentProjects')}</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {recent.map(({ project, status }) => (
              <ProjectCard key={project.id} project={project} status={status} locale={locale} />
            ))}
          </div>
        </section>
      )}

      {/* ── 프로젝트 라이브러리 ── */}
      <section id="project-library" aria-labelledby="library-title" className="scroll-mt-24">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-weak text-brand"><LayoutGrid className="h-4 w-4" /></span>
            <div>
              <div className="eyebrow">Project library</div>
              <h2 id="library-title" className="text-sm font-semibold text-ink">{t(locale, 'home.projectLibrary')}</h2>
            </div>
          </div>
          {total > 0 && <span className="text-xs text-ink-subtle tabular-nums">{total}{t(locale, 'home.countUnit')} · {t(locale, 'home.sortRecent')}</span>}
        </div>

        {total === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title={t(locale, 'home.emptyTitle')}
            description={t(locale, 'home.emptyDesc')}
            action={canCreate ? <NewProjectModal label={t(locale, 'home.newProjectStart')} className="btn btn-primary" /> : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {withStatus.map(({ project, status }) => (
              <ProjectCard key={project.id} project={project} status={status} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
