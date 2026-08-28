import { TrendingUp } from 'lucide-react'
import { issueTrend, type DashboardIssue, type IssueTrendPoint } from '@/lib/domain/issueDashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { MiniEmpty } from './bits'

// S-Curve 와 같은 자체 SVG(의존성 0). 우측 여백(PR)은 끝점 라벨('미해결 999' · 영문 'Backlog 999') 자리.
const W = 640, H = 200, PL = 30, PR = 76, PT = 14, PB = 26
/** 차트 아래 주간 표의 행 수 — 차트(누적)가 못 보여주는 주간 증감을 나르고, 옆의 이슈 현황 카드와 높이를 맞춘다. */
const TREND_TABLE_WEEKS = 6
const WASH_ID = 'issue-backlog-wash'

/** y축 눈금 간격 — 1·2·5×10ⁿ 중 눈금이 5개 안팎이 되는 값(최소 1, 정수). 건수가 커져도 눈금 수가 늘지 않는다. */
function tickStep(max: number): number {
  const raw = Math.max(1, max) / 5
  const pow = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / pow
  return Math.max(1, Math.round((norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow))
}

/** 점 사이를 중점 제어점 3차 곡선으로 잇는다 — 제어점 y 가 양끝 값과 같아 곡선이 두 점의 y 구간을 벗어나지 않는다(backlog 처럼 오르내리는 선도 안전). */
function smoothPath(pts: IssueTrendPoint[], key: 'created' | 'resolved' | 'backlog', x: (i: number) => number, y: (v: number) => number): string {
  return pts.map((p, i) => {
    const px = x(i).toFixed(1), py = y(p[key]).toFixed(1)
    if (i === 0) return `M${px},${py}`
    const x0 = x(i - 1), y0 = y(pts[i - 1][key]).toFixed(1), cx = ((x0 + x(i)) / 2).toFixed(1)
    return `C${cx},${y0} ${cx},${py} ${px},${py}`
  }).join(' ')
}

/**
 * 미해결 추이(A안 · 2026-08-28) — 최근 12주 미해결 잔량을 면(area)으로 앞세우고, 등록 누적(점선)·해결 누적(실선)은
 * 맥락으로 얇게. 아래 이번 주 등록/해결/잔량 타일 + 최근 6주 주간 표(차트의 표 쌍).
 * 해결 누적은 현재 해결 상태의 해결일 기준(재오픈은 빠짐) — 캡션이 이를 명시한다.
 */
export function IssueTrendCard({ issues, today, locale }: {
  issues: DashboardIssue[]
  /** 실제 오늘(seoulToday). */
  today: string
  locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  const model = issueTrend(issues, today)

  // 범례는 차트 아래 — SectionCard actions(shrink-0) 안에 두면 좁은 폭에서 줄바꿈 없이 헤더를 넘친다.
  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-subtle">
      <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded-full bg-delayed" />{tr('dash.issues.backlogNow')}</span>
      <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-ink-muted" />{tr('dash.issues.trendCreated')}</span>
      <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded-full bg-done" />{tr('dash.issues.trendResolved')}</span>
    </div>
  )

  if (model.empty) {
    return (
      <SectionCard eyebrow="BACKLOG" title={tr('dash.issues.trendTitle')} icon={TrendingUp}>
        <MiniEmpty text={tr('dash.issues.empty')} />
      </SectionCard>
    )
  }

  const pts = model.points
  const step = tickStep(model.max)
  const yMax = Math.max(step, Math.ceil(model.max / step) * step)
  const x = (i: number) => PL + (i / (pts.length - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / yMax) * (H - PT - PB)
  const last = pts[pts.length - 1]
  const lastX = x(pts.length - 1)
  const ticks: number[] = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  const xLabels = [0, Math.floor((pts.length - 1) / 3), Math.floor(((pts.length - 1) * 2) / 3), pts.length - 1]
  const backlogPath = smoothPath(pts, 'backlog', x, y)
  const aria = `${tr('dash.issues.trendTitle')} — ${tr('dash.issues.trendCreated')} ${last.created}, ${tr('dash.issues.trendResolved')} ${last.resolved}, ${tr('dash.issues.trendBacklog')} ${last.backlog}`
  const stats: { label: string; value: number; tone?: string }[] = [
    { label: tr('dash.issues.weekCreated'), value: last.createdNew },
    { label: tr('dash.issues.weekResolved'), value: last.resolvedNew, tone: 'text-done' },
    { label: tr('dash.issues.backlogNow'), value: last.backlog },
  ]

  return (
    <SectionCard eyebrow="BACKLOG" title={tr('dash.issues.trendTitle')} icon={TrendingUp}>
      <div className="space-y-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={aria}>
          <defs>
            {/* 그라데이션 stop 색은 CSS 속성으로 줘야 토큰(var)이 풀린다 — 속성값의 var() 는 브라우저마다 다르다 */}
            <linearGradient id={WASH_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--color-delayed)', stopOpacity: 0.28 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-delayed)', stopOpacity: 0.03 }} />
            </linearGradient>
          </defs>
          {ticks.map(v => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
              <text x={PL - 6} y={y(v) + 3} textAnchor="end" fontSize={9} className="fill-ink-subtle">{v}</text>
            </g>
          ))}
          <path d={`${backlogPath} L${lastX.toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`} fill={`url(#${WASH_ID})`} />
          <path d={smoothPath(pts, 'created', x, y)} fill="none" className="stroke-ink-muted" strokeWidth={1.5} strokeDasharray="3 3" />
          <path d={smoothPath(pts, 'resolved', x, y)} fill="none" className="stroke-done" strokeWidth={1.5} />
          <path d={backlogPath} fill="none" className="stroke-delayed" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {/* 끝점 — 표면색 2px 링으로 선 위에서도 읽힌다. 라벨은 미해결 하나뿐이라 충돌이 없다. */}
          <circle cx={lastX} cy={y(last.backlog)} r={4.5} className="fill-delayed stroke-surface" strokeWidth={2} />
          <text x={lastX + 9} y={y(last.backlog) + 3.5} fontSize={10} fontWeight={600} className="fill-ink-muted">
            {tr('dash.issues.trendBacklog')} {last.backlog}
          </text>
          {xLabels.map((i, k) => (
            <text key={i} x={x(i)} y={H - 8} fontSize={9} className="fill-ink-subtle"
              textAnchor={k === 0 ? 'start' : k === xLabels.length - 1 ? 'end' : 'middle'}>
              {fmtDate(pts[i].weekStart)}
            </text>
          ))}
        </svg>
        {legend}

        {/* 이번 주 — 차트가 누적이라 '이번 주에 얼마나 움직였나'는 타일이 나른다 */}
        <div className="grid grid-cols-3 gap-2">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{s.label}</div>
              <div className={`mt-1.5 text-xl font-bold leading-none ${s.tone ?? 'text-ink'}`}>
                {s.value}<small className="ml-1 text-[11px] font-semibold text-ink-subtle">{tr('dash.unitCount')}</small>
              </div>
            </div>
          ))}
        </div>

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
