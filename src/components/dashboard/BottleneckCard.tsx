import { Grid3x3 } from 'lucide-react'
import type { BottleneckCell, BottleneckModel, CellState } from '@/lib/domain/bottleneck'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/** 색조 = 상태(범주형), 질감(빗금) = 두 번째 채널, 글리프 = 세 번째. 색 단독 의미 부여 금지. */
const CELL: Record<CellState, { box: string; glyph: string }> = {
  done:       { box: 'bg-done-weak text-done', glyph: '✓' },
  delayed:    { box: 'bg-delayed-weak text-delayed font-bold', glyph: '⚠' },
  upcoming:   { box: 'hatch bg-pending-weak/50 text-ink-muted', glyph: '○' },
  inProgress: { box: 'bg-progress-weak text-progress font-bold', glyph: '·' },
  empty:      { box: 'bg-surface-2/30 text-ink-subtle', glyph: '' },
}

/** dday>0: 마감까지(D-n), dday<0: 초과(D+n), 0: 당일. */
function ddayStr(dday: number): string {
  if (dday > 0) return `D-${dday}`
  if (dday < 0) return `D+${-dday}`
  return 'D-day'
}

function cellText(c: BottleneckCell, tr: (k: DictKey) => string): { head: string; sub: string } {
  const unit = tr('dash.unitCount')
  switch (c.state) {
    case 'empty':      return { head: '·', sub: '' }
    case 'done':       return { head: '100%', sub: `${c.count}${unit}` }
    // 지연: 얼마나 늦었는지(D+n)가 핵심. 진척%는 부제로.
    case 'delayed':    return { head: c.dday != null ? ddayStr(c.dday) : `${c.avgProgress}%`, sub: `${c.count}${unit} · ${c.avgProgress}%` }
    // 예정: 아무것도 시작 안 함 → 진척% 무의미. 마감까지 남은 일수를 보여준다.
    case 'upcoming':   return { head: c.dday != null ? ddayStr(c.dday) : tr('dash.bottleneck.scheduled'), sub: `${c.count}${unit}` }
    case 'inProgress': return { head: `${c.avgProgress}%`, sub: `${c.count}${unit}` }
  }
}

export async function BottleneckCard({ model }: { model: BottleneckModel }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  const stateLabel: Record<CellState, string> = {
    done: tr('status.done'),
    delayed: tr('dash.bottleneck.delayed'),
    upcoming: tr('dash.bottleneck.scheduled'),
    inProgress: tr('status.in_progress'),
    empty: '—',
  }

  // 셀은 평탄 배열이다. (phaseId, team) → cell 로 조회해 열 순서(model.teams)대로 그린다.
  const cellAt = new Map<string, BottleneckCell>()
  for (const c of model.cells) cellAt.set(`${c.phaseId}|${c.team}`, c)

  return (
    <SectionCard eyebrow="BOTTLENECK" title={tr('dash.bottleneck.title')} icon={Grid3x3} fill
      bodyClassName="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-separate border-spacing-[3px] text-[9px]">
          <caption className="sr-only">{tr('dash.bottleneck.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[46px]"><span className="sr-only">{tr('dash.phase.axis')}</span></th>
              {model.teams.map(team => (
                <th key={team} scope="col" className="p-0.5 text-[8.5px] font-semibold text-ink-subtle">{team}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.phases.map(phase => (
              <tr key={phase.id}>
                <th scope="row" title={phase.name}
                  className="max-w-[46px] truncate p-0.5 text-left text-[8.5px] font-medium text-ink-muted">
                  {phase.name}
                  {phase.unassigned > 0 && (
                    <span className="ml-0.5 align-super text-[7px] text-delayed" title={tr('dash.bottleneck.noOwner')}>*</span>
                  )}
                </th>
                {model.teams.map(team => {
                  const c = cellAt.get(`${phase.id}|${team}`)!
                  const { head, sub } = cellText(c, tr)
                  const style = CELL[c.state]
                  return (
                    <td key={team}
                      aria-label={`${phase.name} · ${team} · ${stateLabel[c.state]}${c.count ? ` · ${c.count}${tr('dash.unitCount')}` : ''}`}
                      className={`relative h-9 rounded px-0.5 text-center leading-tight ${style.box}`}>
                      {style.glyph && <span aria-hidden className="absolute right-0.5 top-0.5 text-[7px] opacity-70">{style.glyph}</span>}
                      <span className="block tabular-nums">{head}</span>
                      {sub && <span className="block text-[7.5px] opacity-70">{sub}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 shrink-0 text-[8.5px] leading-relaxed text-ink-subtle">
        {tr('dash.bottleneck.legend')}
        {model.unassignedCount > 0 && (
          <>
            <br />
            <span className="text-delayed">*</span> {tr('dash.bottleneck.unassignedLeaves')} {model.unassignedCount}{tr('dash.unitCount')} · {tr('dash.bottleneck.noOwner')}
          </>
        )}
      </p>
    </SectionCard>
  )
}
