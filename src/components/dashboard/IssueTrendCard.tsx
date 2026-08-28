import { TrendingUp } from 'lucide-react'
import { issueTrend, type DashboardIssue } from '@/lib/domain/issueDashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { MiniEmpty } from './bits'

// TrendChart(S-Curve)와 같은 자체 SVG(의존성 0). 우측 여백(PR)은 끝점 라벨 자리 —
// 영문 'Resolved 999'(10px) 가 들어가야 해서 S-Curve(12)보다 넓다.
const W = 640, H = 220, PL = 30, PR = 80, PT = 14, PB = 26
/** 끝점 라벨 두 개의 최소 세로 간격(px, viewBox 단위). 등록==해결(백로그 0)이면 같은 좌표라 벌려 그린다. */
const MIN_LABEL_GAP = 12
/** 차트 아래 주간 표의 행 수 — 차트(누적)가 못 보여주는 주간 증감을 나르고, 옆의 이슈 현황 카드와 높이를 맞춘다. */
const TREND_TABLE_WEEKS = 6

/** y축 눈금 간격 — 1·2·5×10ⁿ 중 눈금이 5개 안팎이 되는 값(최소 1, 정수). 건수가 커져도 눈금 수가 늘지 않는다. */
function tickStep(max: number): number {
  const raw = Math.max(1, max) / 5
  const pow = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / pow
  return Math.max(1, Math.round((norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow))
}

/**
 * 등록·해결 추이 — 최근 12주 등록 누적(잉크) vs 해결 누적(done), 두 선 사이 wash 가 미해결 백로그.
 * 해결 누적은 현재 해결 상태의 해결일 기준(재오픈은 빠짐) — 캡션이 이를 명시한다.
 * 호버 툴팁은 v1 제외(서버 컴포넌트, S-Curve 와 동일 수준) — 끝점 라벨·축 눈금·aria-label 이 값을 나른다.
 */
export function IssueTrendCard({ issues, today, locale }: {
  issues: DashboardIssue[]
  /** 실제 오늘(seoulToday). */
  today: string
  locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  const model = issueTrend(issues, today)

  const legend = (
    <div className="flex items-center gap-3 text-[10px] text-ink-subtle">
      <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded-full bg-ink-muted" />{tr('dash.issues.trendCreated')}</span>
      <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded-full bg-done" />{tr('dash.issues.trendResolved')}</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded-sm bg-delayed/15" />{tr('dash.issues.trendBacklog')}</span>
    </div>
  )

  if (model.empty) {
    return (
      <SectionCard eyebrow="ISSUE TREND" title={tr('dash.issues.trendTitle')} icon={TrendingUp}>
        <MiniEmpty text={tr('dash.issues.empty')} />
      </SectionCard>
    )
  }

  const pts = model.points
  const step = tickStep(model.max)
  const yMax = Math.max(step, Math.ceil(model.max / step) * step)
  const x = (i: number) => PL + (i / (pts.length - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / yMax) * (H - PT - PB)
  const poly = (key: 'created' | 'resolved') => pts.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const wash = 'M' + pts.map((p, i) => `${x(i).toFixed(1)},${y(p.created).toFixed(1)}`).join('L')
    + 'L' + [...pts].reverse().map((p, i) => `${x(pts.length - 1 - i).toFixed(1)},${y(p.resolved).toFixed(1)}`).join('L') + 'Z'
  const last = pts[pts.length - 1]
  const lastX = x(pts.length - 1)
  // 끝점 라벨 y — 해결 ≤ 등록이라 해결 라벨이 항상 아래(yR ≥ yC). 가까우면 중점 기준으로 벌린다(원은 실제 위치 유지).
  let yC = y(last.created), yR = y(last.resolved)
  if (yR - yC < MIN_LABEL_GAP) { const mid = (yC + yR) / 2; yC = mid - MIN_LABEL_GAP / 2; yR = mid + MIN_LABEL_GAP / 2 }
  const ticks: number[] = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  const xLabels = [0, Math.floor((pts.length - 1) / 3), Math.floor(((pts.length - 1) * 2) / 3), pts.length - 1]
  const aria = `${tr('dash.issues.trendTitle')} — ${tr('dash.issues.trendCreated')} ${last.created}, ${tr('dash.issues.trendResolved')} ${last.resolved}, ${tr('dash.issues.trendBacklog')} ${last.backlog}`

  return (
    <SectionCard eyebrow="ISSUE TREND" title={tr('dash.issues.trendTitle')} icon={TrendingUp} actions={legend}>
      <div className="space-y-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={aria}>
          {ticks.map(v => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
              <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize={9} className="fill-ink-subtle">{v}</text>
            </g>
          ))}
          <path d={wash} className="fill-delayed" fillOpacity={0.1} />
          <polyline points={poly('created')} fill="none" className="stroke-ink-muted" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={poly('resolved')} fill="none" className="stroke-done" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {/* 끝점 — 표면색 2px 링으로 선 위에서도 읽힌다 */}
          <circle cx={lastX} cy={y(last.created)} r={4} className="fill-ink-muted stroke-surface" strokeWidth={2} />
          <circle cx={lastX} cy={y(last.resolved)} r={4} className="fill-done stroke-surface" strokeWidth={2} />
          <text x={lastX + 9} y={yC + 3.5} fontSize={10} fontWeight={600} className="fill-ink-muted">
            {tr('dash.issues.trendCreatedShort')} {last.created}
          </text>
          <text x={lastX + 9} y={yR + 3.5} fontSize={10} fontWeight={600} className="fill-ink-muted">
            {tr('dash.issues.trendResolvedShort')} {last.resolved}
          </text>
          {xLabels.map((i, k) => (
            <text key={i} x={x(i)} y={H - 8} fontSize={9} className="fill-ink-subtle"
              textAnchor={k === 0 ? 'start' : k === xLabels.length - 1 ? 'end' : 'middle'}>
              {fmtDate(pts[i].weekStart)}
            </text>
          ))}
        </svg>
        {/* 주간 표 — 차트의 표 쌍(값은 툴팁 없이도 읽힌다). 등록·해결은 그 주의 증감, 미해결은 주말 기준 잔량. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px] tabular-nums">
            <caption className="mb-1.5 text-left text-[11px] text-ink-subtle">{tr('dash.issues.trendRecentWeeks')}</caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
                <th scope="col" className="py-1 pr-2 text-left font-semibold">{tr('dash.issues.trendTableWeek')}</th>
                <th scope="col" className="py-1 pl-2 text-right font-semibold">{tr('dash.issues.trendCreatedShort')}</th>
                <th scope="col" className="py-1 pl-2 text-right font-semibold">{tr('dash.issues.trendResolvedShort')}</th>
                <th scope="col" className="py-1 pl-2 text-right font-semibold">{tr('dash.issues.trendBacklog')}</th>
              </tr>
            </thead>
            <tbody>
              {pts.slice(-TREND_TABLE_WEEKS).map(p => (
                <tr key={p.weekStart} className="border-t border-line/70 text-ink-muted">
                  <td className="py-1 pr-2 text-left">{fmtDate(p.weekStart)}</td>
                  <td className="py-1 pl-2 text-right">{p.createdNew}</td>
                  <td className="py-1 pl-2 text-right">{p.resolvedNew}</td>
                  <td className="py-1 pl-2 text-right font-semibold text-ink">{p.backlog}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] leading-4 text-ink-subtle">{tr('dash.issues.trendCaption')}</div>
      </div>
    </SectionCard>
  )
}
