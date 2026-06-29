'use client'

import {
  Activity,
  AlertTriangle,
  CalendarRange,
  Layers,
  Printer,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'
import { Modal } from '@/components/ui/Modal'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { StatusPill } from '@/components/ui/StatusPill'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { TEAM, OwnerBadges, collectLeaves, fmtDate } from '@/components/wbs/shared'

const TEAMS: TeamCode[] = ['PMO', 'DT', 'ERP', 'MES']

/** 정수 평균 (빈 배열 → 0) */
function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0
}

/** 'YYYY-MM-DD' → '2026년 9월 15일' */
function fmtFull(d?: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${y}년 ${Number(m)}월 ${Number(day)}일`
}

/**
 * 현황 보고서 모달 — 인쇄/PDF 가능한 보고서 본문.
 * 본문은 `.print-area`로 감싸 @media print에서 이 영역만 출력된다.
 * '인쇄/PDF'·닫기 버튼은 `.no-print`로 인쇄 시 숨김.
 */
export function ReportModal({
  open,
  onClose,
  items,
  projectName,
  projectDescription,
  today,
  startDate,
  endDate,
}: {
  open: boolean
  onClose: () => void
  items: ComputedItem[]
  projectName: string
  projectDescription?: string | null
  today: string
  startDate?: string | null
  endDate?: string | null
}) {
  const roots = items
  const overallActual = avg(roots.map(r => r.rolledActualPct))
  const overallPlanned = avg(roots.map(r => r.plannedPct))
  const variance = overallActual - overallPlanned

  const leaves = collectLeaves(items)
  const delayed = leaves
    .filter(l => l.status === 'delayed')
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))

  const teamStat = (team: TeamCode) => {
    const assigned = leaves.filter(l => l.owners.some(o => o.team === team))
    return { count: assigned.length, pct: assigned.length ? avg(assigned.map(l => l.rolledActualPct)) : null }
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} className="no-print btn btn-ghost">
        닫기
      </button>
      <button type="button" onClick={() => window.print()} className="no-print btn btn-primary">
        <Printer className="h-4 w-4" />
        인쇄 / PDF
      </button>
    </>
  )

  return (
    <Modal open={open} onClose={onClose} eyebrow="Status report" title="현황 보고서" size="lg" footer={footer}>
      <div className="print-area space-y-6">
        {/* ── 보고서 헤더 ── */}
        <header className="card overflow-hidden p-6">
          <div className="eyebrow">현황 보고서 · Status Report</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{projectName}</h1>
          {projectDescription && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{projectDescription}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-subtle">
            <span>
              생성일 <span className="font-semibold text-ink-muted">{fmtFull(today)}</span>
            </span>
            {(startDate || endDate) && (
              <span>
                기간{' '}
                <span className="font-semibold text-ink-muted">
                  {fmtFull(startDate)} ~ {fmtFull(endDate)}
                </span>
              </span>
            )}
            <span>
              전체 작업 <span className="font-semibold text-ink-muted">{leaves.length}건</span>
            </span>
          </div>
        </header>

        {/* ── 전체 요약 KPI ── */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="전체 실적" value={`${overallActual}%`} sub="Actual progress" icon={Activity} tone="brand" />
          <KpiCard label="전체 계획" value={`${overallPlanned}%`} sub="Planned" icon={CalendarRange} tone="default" />
          <KpiCard
            label="계획 대비 편차"
            value={`${variance > 0 ? '+' : ''}${variance}%p`}
            sub={variance >= 0 ? '계획 이상' : '계획 미달'}
            icon={variance >= 0 ? TrendingUp : TrendingDown}
            tone={variance >= 0 ? 'success' : 'danger'}
          />
          <KpiCard
            label="지연 작업"
            value={String(delayed.length)}
            sub={`전체 ${leaves.length}건 중`}
            icon={AlertTriangle}
            tone="danger"
          />
        </section>

        {/* ── Phase별 진척 ── */}
        <SectionCard eyebrow="By phase" title="Phase별 진척" icon={Layers}>
          {roots.length === 0 ? (
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
                {roots.map(p => {
                  const d = p.rolledActualPct - p.plannedPct
                  return (
                    <tr key={p.id} className="border-b border-line/70 last:border-0">
                      <td className="max-w-0 truncate py-2.5 pr-3 font-medium text-ink" title={p.name}>
                        {p.name}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{p.plannedPct}%</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{p.rolledActualPct}%</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${d >= 0 ? 'text-done' : 'text-delayed'}`}>
                        {d > 0 ? '+' : ''}
                        {d}%p
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <StatusPill status={p.status} />
                      </td>
                    </tr>
                  )
                })}
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
                {delayed.map(l => (
                  <tr key={l.id} className="border-b border-line/70 last:border-0">
                    <td className="max-w-0 truncate py-2.5 pr-3 font-medium text-ink" title={l.name}>
                      {l.name}
                    </td>
                    <td className="px-3 py-2.5">
                      <OwnerBadges owners={l.owners} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-delayed">{fmtDate(l.plannedEnd)}</td>
                    <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-ink">{l.rolledActualPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── 팀별 진척 ── */}
        <SectionCard eyebrow="By owner" title="팀별 진척" icon={Users}>
          <div className="space-y-4">
            {TEAMS.map(team => {
              const s = teamStat(team)
              return (
                <div key={team} className="flex items-center gap-3">
                  <span className="flex w-14 shrink-0 items-center gap-2 text-sm font-semibold text-ink">
                    <span className={`h-2 w-2 rounded-full ${TEAM[team].bar}`} />
                    {team}
                  </span>
                  <span className="w-20 shrink-0 text-xs text-ink-subtle">{s.count}개 작업</span>
                  <div className="flex-1">
                    <ProgressBar value={s.pct ?? 0} tone={TEAM[team].bar} />
                  </div>
                  <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                    {s.pct == null ? '-' : `${s.pct}%`}
                  </span>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </Modal>
  )
}
