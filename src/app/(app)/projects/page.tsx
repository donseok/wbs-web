import Link from 'next/link'
import { Calendar, FolderPlus, LayoutGrid, ArrowDown, History, ArrowRight } from 'lucide-react'
import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { getProjectsCompletion } from '@/lib/data/wbs'
import { createServerClient } from '@/lib/supabase/server'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { EmptyState } from '@/components/ui/EmptyState'
import { NewProjectModal } from '@/components/home/NewProjectModal'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { seoulToday } from '@/lib/domain/dates'

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
  unknown: { labelKey: 'home.status_unknown' as DictKey, chip: 'bg-surface-2 text-ink-muted', dot: 'bg-ink-subtle' },
}

// ── 히어로 통계칩(TASKS / DONE / %) 데이터 ──────────────────────────────────
// 종전에는 전 프로젝트의 풀 WBS 트리(getComputedWbs, 프로젝트당 5쿼리)를 다시 로드해
// 리프를 집계했다(2026-08-18 성능 감사 P1: 쿼리 5N+α). 히어로가 트리에서 실제로 쓰는 것은
// 리프 총수·완료 수뿐이고, 상태 배지는 카운트조차 필요 없어 getProjectsCompletion(레이아웃과
// 공유·React cache dedupe)으로 대체된다. 여기서는 히어로용 카운트만 경량 1쿼리로 얻는다.

type TaskRow = { id: string; parentId: string | null; projectId: string; actualPct: number | null }

// 반환 null = 조회 실패. 빈 배열(WBS 0건, 정상)과 반드시 구분한다 — 실패를 0건으로 뭉개면
// 히어로가 '작업 0건'으로 위장된다(에러 3원칙 ① 표시 = 로깅).
async function fetchTaskRows(): Promise<TaskRow[] | null> {
  const sb = await createServerClient()
  // RLS 가 authenticated 전체 읽기 개방이라 프로젝트 필터 없이 읽는다(getProjectsCompletion 과
  // 같은 컬럼 셋). 비공개 프로젝트 행이 섞여도 아래 heroTaskStats 가 가시 프로젝트 id 로만
  // 집계하므로 화면 유출은 없다. 필터를 넣으면 listProjects 결과를 기다려야 해 직렬 1단이 는다.
  const { data, error } = await sb.from('wbs_items').select('id, parent_id, project_id, actual_pct')
  if (error) {
    console.error('[ProjectsHome] wbs_items 조회 실패:', error.message)
    return null
  }
  return (data ?? []).map(r => ({
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    projectId: r.project_id as string,
    actualPct: (r.actual_pct as number | null) ?? null,
  }))
}

// 트리를 만들지 않고 리프만 센다. 판정 규약은 기존 트리 경로(computeTree→aggregateTaskStats)와 동치:
// - 리프 = 다른 행의 parent 로 참조되지 않는 행 (computeCompletionMap 과 동일 판정. buildTree 의
//   '자식 없는 노드'와 같은 결과이며, 순환 등 비정상 데이터에서는 두 판정이 같이 0 으로 무너진다)
// - done = 원시 actualPct >= 100 (statusOf 의 done 분기와 동일 — 반올림 금지, 99.5 는 미완)
// - donePct = Math.round (기존 aggregateTaskStats 와 동일 — 히어로는 round1 대상이 아니다)
function heroTaskStats(
  rows: TaskRow[], visibleProjectIds: ReadonlySet<string>,
): { tasks: number; done: number; donePct: number } {
  const visible = rows.filter(r => visibleProjectIds.has(r.projectId))
  const parents = new Set<string>()
  for (const r of visible) if (r.parentId) parents.add(r.parentId)
  let tasks = 0
  let done = 0
  for (const r of visible) {
    if (parents.has(r.id)) continue
    tasks += 1
    if ((r.actualPct ?? 0) >= 100) done += 1
  }
  return { tasks, done, donePct: tasks ? Math.round((done / tasks) * 100) : 0 }
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
  // 다섯 조회 전부 상호 독립 — 한 배치로 병렬 실행한다(종전 직렬 3단: 목록 → 로케일 → 트리 5N쿼리).
  // getProjectsCompletion 은 무인자 + React cache 라 하드 로드에서는 레이아웃 실행분에 dedupe 되어
  // 실행 0회 — 이 페이지가 새로 내는 쿼리는 fetchTaskRows 1개뿐이다.
  const [rawProjects, actor, locale, completion, taskRows] = await Promise.all([
    listProjects(),
    getActorForView(),
    getServerLocale(),
    getProjectsCompletion(),
    fetchTaskRows(),
  ])
  const projects = rawProjects as ProjectRow[]
  const today = seoulToday()

  // 히어로 집계 — 실패(null)면 0 으로 위장하지 않고 '–' 를 그린다(아래 heroStats).
  const taskStats = taskRows === null ? null : heroTaskStats(taskRows, new Set(projects.map(p => p.id)))

  // 상태 배지 — 사이드바(레이아웃)와 같은 완료율 맵을 쓴다(카드·사이드바 배지 동원천, 트리 로드 없음).
  // completion === null 은 조회 실패(상태 모름) — 'WBS 없음'으로 뭉개면 종료일 지난 미완 프로젝트가
  // '완료' 배지로 둔갑한다. 맵에 항목이 없는 프로젝트 = WBS 0건(정상)이라 hasWbs:false 로 판정한다.
  const withStatus = projects.map(p => ({
    project: p,
    status: projectLifecycleStatus(
      p.start_date, p.end_date, today,
      completion === null ? null : (completion[p.id] ?? { hasWbs: false, allDone: false }),
    ),
  }))
  const total = withStatus.length
  const recent = withStatus.slice(0, 3)
  // 프로젝트 생성은 슈퍼유저 전용(스펙 §5) — createProject 액션이 재검증한다
  const canCreate = actor?.isSuperuser === true

  const heroStats = [
    { label: 'Tasks', value: taskStats ? taskStats.tasks : '–' },
    { label: 'Done', value: taskStats ? taskStats.done : '–' },
    { label: '%', value: taskStats ? `${taskStats.donePct}%` : '–' },
  ]

  return (
    <div className="space-y-6 pb-20">
      {/* ── 히어로 ── */}
      <section className="hero-glow hero-card flex flex-col gap-5 p-5 sm:p-6">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-hero-ink-muted">Workspace · D&apos;Flow</div>
          <h1 className="mt-2 break-words text-[26px] font-bold leading-tight tracking-tight text-hero-ink sm:text-[34px]">
            {t(locale, 'home.heroTitle')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-hero-ink-muted">
            {t(locale, 'home.heroDesc')}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {heroStats.map(stat => (
              <span
                key={stat.label}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm backdrop-blur"
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
