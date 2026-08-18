import Link from 'next/link'
import { Briefcase, Lock, ArrowRight } from 'lucide-react'
import type { PortfolioRow } from '@/lib/domain/portfolio'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import type { Signal } from '@/lib/domain/dashboard'
import { SIGNAL_META } from '@/components/dashboard/signalStyle'
import { SectionCard } from '@/components/ui/SectionCard'
import { CountBadge, MiniEmpty } from '@/components/dashboard/bits'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

const SIGNAL_LABEL: Record<Signal, DictKey> = {
  green: 'pf.signal.green', amber: 'pf.signal.amber', red: 'pf.signal.red', neutral: 'pf.signal.neutral',
}
const STATUS_CHIP: Record<ProjectLifecycleStatus, { labelKey: DictKey; chip: string; dot: string }> = {
  ready: { labelKey: 'pf.status.ready', chip: 'bg-pending-weak text-pending', dot: 'bg-pending' },
  active: { labelKey: 'pf.status.active', chip: 'bg-brand-weak text-brand', dot: 'bg-brand' },
  overdue: { labelKey: 'pf.status.overdue', chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
  done: { labelKey: 'pf.status.done', chip: 'bg-done-weak text-done', dot: 'bg-done' },
  unknown: { labelKey: 'pf.status.unknown', chip: 'bg-surface-2 text-ink-muted', dot: 'bg-ink-subtle' },
}

const th = 'px-2 py-2 font-semibold'

export function PortfolioTable({ rows, leadersDegraded, locale }: {
  rows: PortfolioRow[]; leadersDegraded: boolean; locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  if (rows.length === 0) {
    return (
      <SectionCard eyebrow="PORTFOLIO" title={tr('pf.table.title')} icon={Briefcase}>
        <MiniEmpty text={tr('pf.empty')} />
      </SectionCard>
    )
  }
  return (
    <SectionCard eyebrow="PORTFOLIO" title={tr('pf.table.title')} icon={Briefcase}
      actions={<CountBadge n={rows.length} unit={tr('pf.unit')} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
              <th className={th}>{tr('pf.col.signal')}</th>
              <th className={th}>{tr('pf.col.project')}</th>
              <th className={th}>{tr('pf.col.progress')}</th>
              <th className={`${th} text-right`}>{tr('pf.col.variance')}</th>
              <th className={`${th} text-right`}>{tr('pf.col.spi')}</th>
              <th className={th}>{tr('pf.col.end')}</th>
              <th className={th}>{tr('pf.col.milestone')}</th>
              <th className={th}>{tr('pf.col.pm')}</th>
              <th className={th}>{tr('pf.col.status')}</th>
              <th className="px-2 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const s = STATUS_CHIP[row.lifecycle]
              const signal = row.exec?.overall.signal ?? 'neutral'
              const m = SIGNAL_META[signal]
              const Icon = m.icon
              const ms = row.exec?.milestone ?? null
              const sched = row.exec?.schedule ?? null
              return (
                <tr key={row.projectId} className="border-b border-line/60 transition hover:bg-surface-2/60">
                  <td className="px-2 py-2.5">
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.chip}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />{tr(SIGNAL_LABEL[signal])}
                    </span>
                  </td>
                  <td className="max-w-[220px] px-2 py-2.5">
                    <Link href={`/p/${row.projectId}/dashboard`}
                      className="inline-flex items-center gap-1.5 font-semibold text-ink hover:text-brand hover:underline">
                      {row.isPrivate && <Lock className="h-3 w-3 shrink-0 text-ink-subtle" aria-label={tr('pf.private')} />}
                      <span className="truncate">{row.name}</span>
                    </Link>
                    {row.baseDate && (
                      <div className="mt-0.5 text-[10px] text-ink-subtle">{tr('pf.baseDate')} {fmtDate(row.baseDate)}</div>
                    )}
                  </td>
                  {row.degraded ? (
                    <td colSpan={5} className="px-2 py-2.5 text-[11px] text-delayed">{tr('pf.degradedRow')}</td>
                  ) : !row.exec ? (
                    <>
                      <td className="px-2 py-2.5"><span className="text-ink-subtle">—</span></td>
                      <td className="px-2 py-2.5 text-right"><span className="text-ink-subtle">—</span></td>
                      <td className="px-2 py-2.5 text-right"><span className="text-ink-subtle">—</span></td>
                      <td className="px-2 py-2.5"><span className="text-ink-subtle">—</span></td>
                      <td className="px-2 py-2.5"><span className="text-ink-subtle">—</span></td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        <span className="font-semibold text-ink">{row.exec!.progress.actual}%</span>
                        <span className="text-ink-subtle"> / {row.exec!.progress.planned}%</span>
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums ${row.exec!.progress.variance < 0 ? 'text-delayed' : 'text-done'}`}>
                        {row.exec!.progress.variance > 0 ? '+' : ''}{row.exec!.progress.variance}%p
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink">
                        {row.spi != null ? row.spi.toFixed(2) : (
                          <span
                            title={tr(
                              row.exec!.schedule.label === 'done' ? 'pf.spi.done'
                                : row.exec!.schedule.label === 'none' ? 'pf.spi.none'
                                  : 'pf.spi.early',
                            )}
                            className="text-ink-subtle"
                          >—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        {sched?.projectedEnd ? (
                          <>
                            <span className="text-ink">{fmtDate(sched.projectedEnd)}</span>
                            {sched.slipDays != null && (
                              <span className={`ml-1 text-[10px] font-semibold ${sched.slipDays > 0 ? 'text-delayed' : 'text-done'}`}>
                                {sched.slipDays > 0 ? `+${sched.slipDays}` : sched.slipDays}d
                              </span>
                            )}
                          </>
                        ) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5">
                        {ms?.name ? (
                          <div className="flex max-w-[180px] items-baseline gap-1">
                            <span className={`min-w-0 truncate ${ms.overdue ? 'text-delayed' : 'text-ink'}`}>{ms.name}</span>
                            <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${ms.overdue ? 'text-delayed' : 'text-ink'}`}>
                              {ms.dday != null && (ms.dday >= 0 ? `D-${ms.dday}` : `D+${-ms.dday}`)}
                            </span>
                          </div>
                        ) : <span className="text-ink-subtle">—</span>}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2.5 text-ink-muted">
                    <div className="max-w-[140px] truncate">
                      {leadersDegraded ? tr('pf.leadersUnknown') : (row.leaders.join(', ') || '—')}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={`chip ${s.chip} whitespace-nowrap`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {tr(s.labelKey)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/p/${row.projectId}/dashboard`} aria-label={`${row.name} 대시보드`}
                      className="text-ink-subtle transition hover:text-brand">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
