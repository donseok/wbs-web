import { LayoutGrid } from 'lucide-react'
import type { MatrixRow } from '@/lib/domain/dashboard'
import { progressSignal, type Signal } from '@/lib/domain/dashboard'
import type { TeamCode } from '@/lib/domain/types'
import { SectionCard } from '@/components/ui/SectionCard'
import { TEAM } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

const SIG_CELL: Record<Signal, string> = {
  green: 'bg-done-weak text-done',
  amber: 'bg-pending-weak text-accent-warning',
  red: 'bg-delayed-weak text-delayed',
  neutral: 'bg-surface-2 text-ink-muted',
}
const SIG_TEXT: Record<Signal, string> = {
  green: 'text-done', amber: 'text-accent-warning', red: 'text-delayed', neutral: 'text-ink',
}

/** Phase(행) × 팀(열) 진척 히트맵. 셀 틴트 = 편차 신호(progressSignal), 숫자 병기(색맹 대비). */
export async function ProgressMatrix({ rows, teams }: { rows: MatrixRow[]; teams: readonly TeamCode[] }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const fmtPp = (n: number) => `${n >= 0 ? '+' : ''}${n}%p`

  return (
    <SectionCard eyebrow="PHASE × TEAM" title={tr('dash.matrix.title')} icon={LayoutGrid}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-ink-subtle">
              <th className="pb-2 pr-3 text-left font-semibold">{tr('dash.matrix.colPhase')}</th>
              {teams.map(team => (
                <th key={team} className="px-2 pb-2 text-center font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${TEAM[team].bar}`} />{team}
                  </span>
                </th>
              ))}
              <th className="px-2 pb-2 text-right font-semibold">{tr('dash.matrix.colOverall')}</th>
              <th className="pb-2 pl-2 text-right font-semibold">{tr('dash.matrix.colVariance')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="max-w-40 truncate py-2.5 pr-3 font-medium text-ink" title={r.name}>{r.name}</td>
                {r.cells.map((c, i) => (
                  <td key={teams[i]} className="px-2 py-2.5 text-center">
                    {c == null ? <span className="text-ink-subtle">—</span> : (
                      <span
                        className={`inline-flex min-w-12 justify-center rounded-lg px-2 py-1 font-semibold tabular-nums ${SIG_CELL[progressSignal(c.pct - c.planned)]}`}
                        title={`${c.count}${tr('dash.unitCount')}`}
                      >
                        {c.pct}%
                      </span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">{r.overall}%</td>
                <td className={`py-2.5 pl-2 text-right font-semibold tabular-nums ${SIG_TEXT[progressSignal(r.variance)]}`}>{fmtPp(r.variance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
