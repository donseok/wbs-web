import type { ReactNode } from 'react'
import { Upload, Download, CalendarDays, Settings, Shield, ListTree, CalendarRange, Info, RefreshCw, Lock, Sparkles } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { collectLeaves, fmtDate } from '@/components/wbs/shared'
import { ProjectInfoEditButton } from '@/components/settings/ProjectInfoEditButton'
import { ScheduleManager } from '@/components/settings/ScheduleManager'
import { WbsImportForm } from '@/components/settings/WbsImportForm'
import { ReindexButton } from '@/components/settings/ReindexButton'
import { dkbotIndexStatus, type IndexStatus } from '@/lib/ai/health'
import { t, type Locale } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

type ProjectRow = {
  id: string
  name: string
  description?: string | null
  start_date: string | null
  end_date: string | null
  base_date?: string | null
  created_at?: string | null
}

/** DK Bot 색인 신선도 → 배지 라벨/색상. 무신호 실패(키 미설정·마이그레이션 미적용·stale)를 가시화. */
function dkbotBadge(s: IndexStatus, locale: Locale): { label: string; cls: string } {
  switch (s.freshness) {
    case 'fresh':
      return { label: `${t(locale, 'settings.badgeFresh')} · ${s.indexed}${t(locale, 'settings.badgeFreshUnit')}`, cls: 'bg-done-weak text-done' }
    case 'stale':
      return { label: t(locale, 'settings.badgeStale'), cls: 'bg-pending-weak text-pending' }
    case 'schema_missing':
      return { label: t(locale, 'settings.badgePreparing'), cls: 'bg-delayed-weak text-delayed' }
    case 'disabled':
      return { label: t(locale, 'settings.badgeDisabled'), cls: 'bg-pending-weak text-pending' }
    case 'empty':
      return { label: t(locale, 'settings.badgeEmpty'), cls: 'bg-pending-weak text-pending' }
    default:
      return { label: t(locale, 'settings.badgeUnknown'), cls: 'bg-pending-weak text-pending' }
  }
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-32 shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm leading-6 text-ink">{children}</dd>
    </div>
  )
}

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, holidays }, projects, membership, dkIndex] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getMembership(),
    dkbotIndexStatus(projectId),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  const isPmo = membership?.role === 'pmo_admin'
  const canMutate = isPmo
  const taskCount = collectLeaves(items).length

  const scheduleLabel =
    project?.start_date || project?.end_date
      ? `${fmtDate(project?.start_date ?? null)} – ${fmtDate(project?.end_date ?? null)}`
      : t(locale, 'settings.tbd')

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="SETTINGS"
        badge={<HeroBadge>Smart Utility</HeroBadge>}
        title={`${project?.name ?? t(locale, 'settings.projectFallback')} ${t(locale, 'settings.heroTitleSuffix')}`}
        description={t(locale, 'settings.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TASKS" value={taskCount} sub={t(locale, 'settings.kpiTasksSub')} icon={ListTree} tone="brand" />
            <KpiCard
              variant="hero"
              label="BASE DATE"
              value={project?.base_date ? fmtDate(project.base_date) : t(locale, 'settings.kpiBaseAuto')}
              sub={project?.base_date ? t(locale, 'settings.kpiBaseSubManual') : t(locale, 'settings.kpiBaseSubToday')}
              icon={CalendarDays}
            />
            <KpiCard
              variant="hero"
              label="SCHEDULE"
              value={<span className="text-[15px] font-bold tabular-nums">{scheduleLabel}</span>}
              sub={t(locale, 'settings.kpiScheduleSub')}
              icon={CalendarRange}
              tone="success"
            />
          </>
        }
      />

      {/* ── 기본 정보 ── */}
      <SectionCard
        eyebrow="CORE INFORMATION"
        title={t(locale, 'settings.coreInfoTitle')}
        icon={Info}
        actions={canMutate && project ? (
          <ProjectInfoEditButton
            projectId={projectId}
            name={project.name}
            description={project.description ?? null}
            startDate={project.start_date ?? null}
            endDate={project.end_date ?? null}
          />
        ) : undefined}
      >
        <dl className="-mt-1">
          <InfoRow label={t(locale, 'settings.projectName')}>
            <span className="font-semibold">{project?.name ?? t(locale, 'settings.unassigned')}</span>
          </InfoRow>
          <InfoRow label={t(locale, 'settings.description')}>
            {project?.description?.trim() || (
              <span className="text-ink-subtle">{t(locale, 'settings.noDescription')}</span>
            )}
          </InfoRow>
          <InfoRow label={t(locale, 'settings.startDate')}>
            <span className="tabular-nums">{project?.start_date ? fmtDate(project.start_date) : t(locale, 'settings.tbd')}</span>
          </InfoRow>
          <InfoRow label={t(locale, 'settings.endDate')}>
            <span className="tabular-nums">{project?.end_date ? fmtDate(project.end_date) : t(locale, 'settings.tbd')}</span>
          </InfoRow>
        </dl>
        {!isPmo && (
          <p className="mt-4 flex items-center gap-1.5 text-xs leading-5 text-ink-subtle">
            <Lock className="h-3.5 w-3.5" />
            {t(locale, 'settings.pmoOnlyNotice')}
          </p>
        )}
      </SectionCard>

      {/* ── WBS 데이터 가져오기 / 내보내기 ── */}
      <SectionCard
        eyebrow="DATA"
        title={t(locale, 'settings.importExportTitle')}
        icon={Upload}
        actions={!canMutate ? <span className="badge bg-pending-weak px-2 py-1 text-pending">{t(locale, 'settings.pmoOnlyBadge')}</span> : undefined}
      >
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
          {t(locale, 'settings.importDesc')}
        </p>
        {canMutate ? (
          <WbsImportForm projectId={projectId} />
        ) : (
          <div className="panel-soft flex min-h-32 items-center gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pending-weak text-pending">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{t(locale, 'settings.noImportPermission')}</p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">{t(locale, 'settings.noImportPermissionDesc')}</p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-ink-muted">{t(locale, 'settings.exportDesc')}</p>
          <a
            href={`/api/export?projectId=${projectId}`}
            className="btn btn-ghost shrink-0"
            aria-label={t(locale, 'settings.exportAria')}
          >
            <Download className="h-4 w-4" /> {t(locale, 'settings.exportExcel')}
          </a>
        </div>
      </SectionCard>

      {/* ── DK Bot 의미검색 색인 ── */}
      <SectionCard
        eyebrow="AI ASSISTANT"
        title={t(locale, 'settings.dkbotTitle')}
        icon={Sparkles}
        actions={
          <div className="flex items-center gap-2">
            <span className={`badge px-2 py-1 ${dkbotBadge(dkIndex, locale).cls}`}>{dkbotBadge(dkIndex, locale).label}</span>
            {canMutate ? (
              <ReindexButton projectId={projectId} />
            ) : (
              <span className="badge bg-pending-weak px-2 py-1 text-pending">{t(locale, 'settings.pmoOnlyBadge')}</span>
            )}
          </div>
        }
      >
        <p className="-mt-2 text-xs leading-5 text-ink-muted">
          {t(locale, 'settings.dkbotDesc1')}<span className="font-medium text-pending">{t(locale, 'settings.dkbotDescBadge')}</span>{t(locale, 'settings.dkbotDesc2')}
          <br />
          <span className="text-ink-subtle">
            {t(locale, 'settings.dkbotDesc3')}
          </span>
        </p>
      </SectionCard>

      {/* ── 일정 기준 및 공휴일 ── */}
      <SectionCard
        eyebrow="CALENDAR"
        title={t(locale, 'settings.calendarTitle')}
        icon={CalendarDays}
        actions={!canMutate ? <span className="badge bg-pending-weak px-2 py-1 text-pending">{t(locale, 'settings.pmoOnlyBadge')}</span> : undefined}
      >
        <ScheduleManager
          projectId={projectId}
          baseDate={project?.base_date ?? null}
          holidays={holidays}
          canEdit={canMutate}
        />
      </SectionCard>

      {/* ── 프로젝트 상태 관리 (시각 전용) ── */}
      <SectionCard eyebrow="STATUS POLICY" title={t(locale, 'settings.statusPolicyTitle')} icon={Settings}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
          {t(locale, 'settings.statusPolicyDesc')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-brand-ring bg-brand-weak/40 p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-weak text-brand">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{t(locale, 'settings.autoSyncTitle')}</p>
                <span className="badge bg-brand-weak text-brand">{t(locale, 'settings.currentlyApplied')}</span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              {t(locale, 'settings.autoSyncDesc')}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-ink-muted">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{t(locale, 'settings.baseDatePolicyTitle')}</p>
                {project?.base_date
                  ? <span className="badge bg-pending-weak text-accent-warning">{t(locale, 'settings.manualFixed')} · {project.base_date}</span>
                  : <span className="badge bg-brand-weak text-brand">{t(locale, 'settings.autoTodayShort')}</span>}
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              {t(locale, 'settings.baseDatePolicyDesc')}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
