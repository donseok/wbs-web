import type { ReactNode } from 'react'
import { Upload, Download, CalendarDays, Settings, Shield, ListTree, CalendarRange, Info, RefreshCw, Lock } from 'lucide-react'
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

type ProjectRow = {
  id: string
  name: string
  description?: string | null
  start_date: string | null
  end_date: string | null
  base_date?: string | null
  created_at?: string | null
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
  const [{ items, holidays }, projects, membership] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getMembership(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  const isPmo = membership?.role === 'pmo_admin'
  const canMutate = isPmo
  const taskCount = collectLeaves(items).length

  const scheduleLabel =
    project?.start_date || project?.end_date
      ? `${fmtDate(project?.start_date ?? null)} – ${fmtDate(project?.end_date ?? null)}`
      : '미정'

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="SETTINGS"
        badge={<HeroBadge>Smart Utility</HeroBadge>}
        title={`${project?.name ?? '프로젝트'} 설정`}
        description="프로젝트 메타 정보와 데이터 관리를 한곳에서 조정합니다."
        aside={
          <>
            <KpiCard label="TASKS" value={taskCount} sub="등록된 리프 작업" icon={ListTree} tone="brand" />
            <KpiCard
              label="BASE DATE"
              value={project?.base_date ? fmtDate(project.base_date) : '자동'}
              sub={project?.base_date ? '공정율 기준일(수동)' : '공정율 기준일(오늘)'}
              icon={CalendarDays}
            />
            <KpiCard
              label="SCHEDULE"
              value={<span className="text-[15px] font-bold tabular-nums">{scheduleLabel}</span>}
              sub="프로젝트 일정"
              icon={CalendarRange}
              tone="success"
            />
          </>
        }
      />

      {/* ── 기본 정보 ── */}
      <SectionCard
        eyebrow="CORE INFORMATION"
        title="기본 정보"
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
          <InfoRow label="프로젝트명">
            <span className="font-semibold">{project?.name ?? '미지정'}</span>
          </InfoRow>
          <InfoRow label="설명">
            {project?.description?.trim() || (
              <span className="text-ink-subtle">설명이 아직 없습니다.</span>
            )}
          </InfoRow>
          <InfoRow label="시작일">
            <span className="tabular-nums">{project?.start_date ? fmtDate(project.start_date) : '미정'}</span>
          </InfoRow>
          <InfoRow label="종료일">
            <span className="tabular-nums">{project?.end_date ? fmtDate(project.end_date) : '미정'}</span>
          </InfoRow>
        </dl>
        {!isPmo && (
          <p className="mt-4 flex items-center gap-1.5 text-xs leading-5 text-ink-subtle">
            <Lock className="h-3.5 w-3.5" />
            기본 정보 변경은 PMO 관리자만 가능합니다.
          </p>
        )}
      </SectionCard>

      {/* ── WBS 데이터 가져오기 / 내보내기 ── */}
      <SectionCard
        eyebrow="DATA"
        title="WBS 데이터 가져오기 · 내보내기"
        icon={Upload}
        actions={!canMutate ? <span className="badge bg-pending-weak px-2 py-1 text-pending">PMO 관리자 전용</span> : undefined}
      >
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
          Excel 형식의 작업 구조와 일정을 프로젝트에 반영합니다.
        </p>
        {canMutate ? (
          <WbsImportForm projectId={projectId} />
        ) : (
          <div className="panel-soft flex min-h-32 items-center gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pending-weak text-pending">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">가져오기 권한이 없습니다</p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">프로젝트의 PMO 관리자에게 WBS 업데이트를 요청하세요.</p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-ink-muted">현재 WBS·일정·담당·실적을 Excel로 내려받습니다. 같은 형식으로 다시 가져올 수 있어요.</p>
          <a
            href={`/api/export?projectId=${projectId}`}
            className="btn btn-ghost shrink-0"
            aria-label="WBS를 Excel 파일로 내보내기"
          >
            <Download className="h-4 w-4" /> Excel 내보내기
          </a>
        </div>
      </SectionCard>

      {/* ── 일정 기준 및 공휴일 ── */}
      <SectionCard
        eyebrow="CALENDAR"
        title="일정 기준 및 공휴일"
        icon={CalendarDays}
        actions={!canMutate ? <span className="badge bg-pending-weak px-2 py-1 text-pending">PMO 관리자 전용</span> : undefined}
      >
        <ScheduleManager
          projectId={projectId}
          baseDate={project?.base_date ?? null}
          holidays={holidays}
          canEdit={canMutate}
        />
      </SectionCard>

      {/* ── 프로젝트 상태 관리 (시각 전용) ── */}
      <SectionCard eyebrow="STATUS POLICY" title="프로젝트 상태 관리" icon={Settings}>
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
          작업 상태(시작전·진행중·지연·완료)를 산정하는 방식을 정의합니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-brand-ring bg-brand-weak/40 p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-weak text-brand">
                <RefreshCw className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">자동 상태 동기화</p>
                <span className="badge bg-brand-weak text-brand">현재 적용</span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              실적·계획·기준일을 비교해 상태를 실시간으로 계산합니다. 별도 입력 없이 일정이 흐르면 자동 갱신됩니다.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-ink-muted">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">공정율 기준일 정책</p>
                {project?.base_date
                  ? <span className="badge bg-pending-weak text-accent-warning">수동 고정 · {project.base_date}</span>
                  : <span className="badge bg-brand-weak text-brand">자동 · 오늘</span>}
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              위 &lsquo;일정 기준 및 공휴일&rsquo;에서 기준일을 고정하면 그 날짜로 상태를 계산하고, 비워두면 매일 오늘 기준으로 자동 갱신됩니다.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
