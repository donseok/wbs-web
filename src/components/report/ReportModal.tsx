'use client'

import {
  Activity,
  AlertTriangle,
  CalendarRange,
  FileSpreadsheet,
  Layers,
  Presentation,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { buildReportModel } from '@/lib/report/model'
import { Modal } from '@/components/ui/Modal'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { StatusPill } from '@/components/ui/StatusPill'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { TEAM, OwnerBadges, fmtDate } from '@/components/wbs/shared'

/** 'YYYY-MM-DD' → '2026년 9월 15일' */
function fmtFull(d?: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${y}년 ${Number(m)}월 ${Number(day)}일`
}

/**
 * 주간 보고서 모달 — Excel·PPT 다운로드 가능한 보고서 본문. (인쇄/PDF 버튼은 사용자 요청으로 제거)
 * 화면은 buildReportModel(정수 표기), Excel은 buildWeeklyReportModel(소수 1자리)을 사용한다.
 */
export function ReportModal({
  open,
  onClose,
  projectId,
  items,
  projectName,
  projectDescription,
  today,
  startDate,
  endDate,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  items: ComputedItem[]
  projectName: string
  projectDescription?: string | null
  today: string
  startDate?: string | null
  endDate?: string | null
}) {
  const model = buildReportModel(
    items,
    { name: projectName, description: projectDescription, start_date: startDate, end_date: endDate },
    today,
  )
  const { meta, kpi, phases, delayed, teams } = model

  const footer = (
    <>
      <button type="button" onClick={onClose} className="no-print btn btn-ghost">
        닫기
      </button>
      <a
        href={`/api/report?projectId=${encodeURIComponent(projectId)}&format=xlsx`}
        className="no-print btn btn-ghost"
        download
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </a>
      <a
        href={`/api/report?projectId=${encodeURIComponent(projectId)}&format=pptx`}
        className="no-print btn btn-ghost"
        download
      >
        <Presentation className="h-4 w-4" />
        PPT
      </a>
    </>
  )

  return (
    <Modal open={open} onClose={onClose} eyebrow="Weekly report" title="주간 보고서" size="lg" footer={footer}>
      <div className="print-area space-y-6">
        {/* ── 보고서 헤더 ── */}
        <header className="card overflow-hidden p-6">
          <div className="eyebrow">주간 보고서 · Weekly Report</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{meta.projectName}</h1>
          {meta.description && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{meta.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-subtle">
            <span>
              생성일 <span className="font-semibold text-ink-muted">{fmtFull(meta.today)}</span>
            </span>
            {(meta.startDate || meta.endDate) && (
              <span>
                기간{' '}
                <span className="font-semibold text-ink-muted">
                  {fmtFull(meta.startDate)} ~ {fmtFull(meta.endDate)}
                </span>
              </span>
            )}
            <span>
              전체 작업 <span className="font-semibold text-ink-muted">{meta.totalLeaves}건</span>
            </span>
          </div>
        </header>

        {/* ── 전체 요약 KPI ── */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="전체 실적" value={`${kpi.actual}%`} sub="Actual progress" icon={Activity} tone="brand" />
          <KpiCard label="전체 계획" value={`${kpi.planned}%`} sub="Planned" icon={CalendarRange} tone="default" />
          <KpiCard
            label="계획 대비 편차"
            value={`${kpi.variance > 0 ? '+' : ''}${kpi.variance}%p`}
            sub={kpi.variance >= 0 ? '계획 이상' : '계획 미달'}
            icon={kpi.variance >= 0 ? TrendingUp : TrendingDown}
            tone={kpi.variance >= 0 ? 'success' : 'danger'}
          />
          <KpiCard
            label="지연 작업"
            value={String(kpi.delayedCount)}
            sub={`전체 ${meta.totalLeaves}건 중`}
            icon={AlertTriangle}
            tone="danger"
          />
        </section>

        {/* ── Phase별 진척 ── */}
        <SectionCard eyebrow="By phase" title="Phase별 진척" icon={Layers}>
          {phases.length === 0 ? (
            <p className="text-sm text-ink-muted">표시할 Phase가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3 font-semibold">Phase</th>
                  <th className="px-3 py-2 text-right font-semibold">계획</th>
                  <th className="px-3 py-2 text-right font-semibold">실적</th>
                  <th className="px-3 py-2 text-right font-semibold">편차</th>
                  <th className="py-2 pl-3 text-right font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p, i) => (
                  <tr key={i} className="border-b border-line/70 last:border-0">
                    <td className="max-w-0 truncate py-2.5 pr-3 font-medium text-ink" title={p.name}>
                      {p.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{p.plannedPct}%</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{p.actualPct}%</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${p.variance >= 0 ? 'text-done' : 'text-delayed'}`}>
                      {p.variance > 0 ? '+' : ''}
                      {p.variance}%p
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── 지연 작업 목록 ── */}
        <SectionCard eyebrow="At risk" title="지연 작업 목록" icon={AlertTriangle}>
          {delayed.length === 0 ? (
            <p className="text-sm text-ink-muted">현재 지연된 작업이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3 font-semibold">작업명</th>
                  <th className="px-3 py-2 font-semibold">담당</th>
                  <th className="px-3 py-2 text-right font-semibold">종료일</th>
                  <th className="py-2 pl-3 text-right font-semibold">실적</th>
                </tr>
              </thead>
              <tbody>
                {delayed.map((l, i) => (
                  <tr key={i} className="border-b border-line/70 last:border-0">
                    <td className="max-w-0 truncate py-2.5 pr-3 font-medium text-ink" title={l.name}>
                      {l.name}
                    </td>
                    <td className="px-3 py-2.5">
                      <OwnerBadges owners={l.owners} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-delayed">{fmtDate(l.plannedEnd)}</td>
                    <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-ink">{l.actualPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── 팀별 진척 ── */}
        <SectionCard eyebrow="By owner" title="팀별 진척" icon={Users}>
          <div className="space-y-4">
            {teams.map(s => (
              <div key={s.team} className="flex items-center gap-3">
                <span className="flex w-14 shrink-0 items-center gap-2 text-sm font-semibold text-ink">
                  <span className={`h-2 w-2 rounded-full ${TEAM[s.team].bar}`} />
                  {s.team}
                </span>
                <span className="w-20 shrink-0 text-xs text-ink-subtle">{s.count}개 작업</span>
                <div className="flex-1">
                  <ProgressBar value={s.pct ?? 0} tone={TEAM[s.team].bar} />
                </div>
                <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                  {s.pct == null ? '-' : `${s.pct}%`}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </Modal>
  )
}
