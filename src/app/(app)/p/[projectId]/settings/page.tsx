import type { ReactNode } from 'react'
import { Upload, CalendarDays, Settings, Shield, ListTree, CalendarRange, Info, RefreshCw, Lock } from 'lucide-react'
import { getComputedWbs } from '@/lib/data/wbs'
import { listProjects } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { collectLeaves, fmtDate } from '@/components/wbs/shared'

type ProjectRow = {
  id: string
  name: string
  description?: string | null
  start_date: string | null
  end_date: string | null
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
  const [{ items }, projects, membership] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getMembership(),
  ])
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  const isPmo = membership?.role === 'pmo_admin'
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
              value={project?.start_date ? fmtDate(project.start_date) : '미정'}
              sub="공정율 기준일"
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
      <SectionCard eyebrow="CORE INFORMATION" title="기본 정보" icon={Info}>
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
        <p className="mt-4 flex items-center gap-1.5 text-xs leading-5 text-ink-subtle">
          <Lock className="h-3.5 w-3.5" />
          기본 정보는 프로젝트 생성 시 입력한 값입니다. 변경은 추후 지원될 예정입니다.
        </p>
      </SectionCard>

      {/* ── WBS 데이터 가져오기 (기존 폼 유지) ── */}
      <SectionCard
        eyebrow="DATA"
        title="WBS 데이터 가져오기"
        icon={Upload}
        actions={!isPmo ? <span className="badge bg-pending-weak px-2 py-1 text-pending">PMO 관리자 전용</span> : undefined}
      >
        <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
          Excel 형식의 작업 구조와 일정을 프로젝트에 반영합니다.
        </p>
        {isPmo ? (
          <form action="/api/import" method="post" encType="multipart/form-data">
            <input type="hidden" name="projectId" value={projectId} />
            <label className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 px-6 text-center transition hover:border-brand hover:bg-brand-weak/40">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-brand shadow-sm transition group-hover:border-brand-ring">
                <Upload className="h-5 w-5" />
              </span>
              <span className="mt-4 text-sm font-semibold text-ink">WBS Excel 파일을 선택하세요</span>
              <span className="mt-1 text-xs leading-5 text-ink-muted">.xlsx 파일만 지원 · 가져오기 전 파일 형식을 검증합니다</span>
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="mt-4 max-w-full text-xs text-ink-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-weak file:px-3 file:py-2 file:font-semibold file:text-brand"
              />
            </label>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Shield className="h-3.5 w-3.5 text-done" />
                파일 구조를 확인한 뒤 업로드합니다.
              </p>
              <button className="btn btn-primary">
                <Upload className="h-4 w-4" />
                검증 후 가져오기
              </button>
            </div>
          </form>
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
      </SectionCard>

      {/* ── 일정 기준 및 공휴일 (준비 중) ── */}
      <SectionCard
        eyebrow="CALENDAR"
        title="일정 기준 및 공휴일"
        icon={CalendarDays}
        actions={<span className="badge bg-pending-weak text-pending">준비 중</span>}
      >
        <p className="-mt-2 text-xs leading-5 text-ink-muted">
          간트 차트에 적용되는 비근무일과 프로젝트 기준 일정을 관리합니다.
        </p>
        <div className="panel-soft mt-4 flex min-h-28 items-center gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">공휴일·기준일 편집기 준비 중</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              현재는 가져온 WBS 파일의 공휴일 정보를 그대로 사용합니다.
            </p>
          </div>
        </div>
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
                <p className="text-sm font-semibold text-ink">수동 상태 고정</p>
                <span className="badge bg-pending-weak text-pending">준비 중</span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              특정 작업의 상태를 담당자가 직접 고정해 자동 계산을 덮어쓰는 정책입니다. 향후 릴리스에서 지원됩니다.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
