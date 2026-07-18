'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  FileSpreadsheet,
  Layers,
  Loader2,
  Presentation,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { ensureProjectBriefAction, getProjectBriefAction } from '@/app/actions/brief'
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
 * 화면은 buildReportModel(전체 실적/계획·편차는 대시보드와 같은 소수 1자리, 나머지 표는 정수),
 * Excel은 buildWeeklyReportModel(소수 1자리)을 사용한다.
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

  // ── PPT 'AI 코멘트 포함' — 신선한 캐시가 있을 때만 활성(LLM 0콜 조회). stale/부재면
  // 인라인 생성 버튼을 노출한다. 409 최종 방어는 서버(/api/report ai=1)가 담당하고
  // 여기는 평시 게이트만 — 실패는 문구로 정직하게 표시(조용한 비활성 금지).
  const [aiStatus, setAiStatus] = useState<'loading' | 'fresh' | 'stale' | 'none' | 'failed'>('loading')
  const [aiChecked, setAiChecked] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [pptBusy, setPptBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setAiStatus('loading')
    setAiChecked(false)
    setAiError(null)
    getProjectBriefAction(projectId)
      .then(r => { if (alive) setAiStatus(r.fresh ? 'fresh' : r.hasBrief ? 'stale' : 'none') })
      .catch(() => { if (alive) setAiStatus('failed') })
    return () => { alive = false }
  }, [open, projectId])

  const generateBrief = async () => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const r = await ensureProjectBriefAction(projectId)
      if (r.state !== 'unavailable' && r.fresh) { setAiStatus('fresh'); setAiChecked(true) }
      else setAiStatus('failed')
    } catch {
      setAiStatus('failed')
    } finally {
      setAiBusy(false)
    }
  }

  const withAi = aiChecked && aiStatus === 'fresh'
  const pptHref = `/api/report?projectId=${encodeURIComponent(projectId)}&format=pptx${withAi ? '&ai=1' : ''}`

  // ai=1 다운로드는 fetch 경유 — <a download> 는 서버 409(브리핑 stale)의 JSON 안내를
  // 사용자에게 보여줄 수 없어 무설명 실패가 된다(리뷰 확정). 모달을 열어둔 사이 데이터가
  // 바뀌는 레이스에서 409 원인을 인라인으로 표시하고 신선도 게이트를 되돌린다.
  const downloadAiPpt = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!withAi || pptBusy) { if (pptBusy) e.preventDefault(); return }
    e.preventDefault()
    setPptBusy(true)
    setAiError(null)
    try {
      const res = await fetch(pptHref)
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        setAiError(j?.error ?? 'AI 코멘트 포함 다운로드에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        if (res.status === 409) { setAiStatus('stale'); setAiChecked(false) }
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''([^;]+)/)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = m ? decodeURIComponent(m[1]) : 'report.pptx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setAiError('다운로드에 실패했습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해 주세요.')
    } finally {
      setPptBusy(false)
    }
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} className="no-print btn btn-ghost">
        닫기
      </button>
      <label className={`no-print flex items-center gap-1.5 text-xs ${aiStatus === 'fresh' ? 'text-ink-muted' : 'text-ink-subtle'}`}
        title={aiStatus === 'fresh' ? 'PPT 마지막에 AI 종합 코멘트 슬라이드를 추가합니다' : '신선한 AI 브리핑이 있어야 포함할 수 있습니다'}>
        <input type="checkbox" checked={withAi} disabled={aiStatus !== 'fresh'}
          onChange={e => setAiChecked(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
        AI 코멘트 포함
      </label>
      {(aiStatus === 'stale' || aiStatus === 'none' || aiStatus === 'failed') && (
        <button type="button" onClick={generateBrief} disabled={aiBusy}
          className="no-print btn btn-ghost !text-xs disabled:opacity-60">
          {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {aiBusy ? '생성 중…' : aiStatus === 'failed' ? '생성 실패 — 다시 시도' : 'AI 브리핑 생성'}
        </button>
      )}
      <a
        href={`/api/report?projectId=${encodeURIComponent(projectId)}&format=xlsx`}
        className="no-print btn btn-ghost"
        download
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </a>
      <a
        href={pptHref}
        onClick={downloadAiPpt}
        className={`no-print btn btn-ghost ${pptBusy ? 'pointer-events-none opacity-60' : ''}`}
        download
      >
        {pptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
        PPT
      </a>
      {aiError && <span className="no-print w-full text-right text-xs text-accent-warning">{aiError}</span>}
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

        {/* ── 팀별 진척현황 ── */}
        <SectionCard eyebrow="By owner" title="팀별 진척현황" icon={Users}>
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
