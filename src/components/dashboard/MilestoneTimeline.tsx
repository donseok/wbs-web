import { Flag } from 'lucide-react'
import type { MilestonePoint, MilestoneStatus } from '@/lib/domain/dashboard'
import { diffDaysCal, addDaysCal } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty } from './bits'

const MS_TONE: Record<MilestoneStatus, string> = { done: 'fill-done', overdue: 'fill-delayed', upcoming: 'fill-brand' }
const W = 960, PL = 24, PR = 24
const FS_NAME = 10, FS_SUB = 9, LH = 12
const MAX_LINE_W = 150, MAX_LINES = 3

/** 서버에서 실측 없이 라벨 폭을 어림한다 — 한글/CJK ≈ 1em, 그 외 ≈ 0.55em. */
const charW = (ch: string, fs: number) => (ch.charCodeAt(0) > 0x2e7f ? fs : fs * 0.55)
const textWidth = (s: string, fs: number) => Array.from(s).reduce((w, ch) => w + charW(ch, fs), 0)

/** 이름을 공백 우선으로 MAX_LINE_W 폭에 맞춰 줄바꿈. 공백 없는 긴 토큰은 강제 분할, MAX_LINES 초과분만 말줄임. */
function wrapName(name: string): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of name.split(' ')) {
    let rest = word
    while (textWidth(rest, FS_NAME) > MAX_LINE_W) {
      if (cur) { lines.push(cur); cur = '' }
      let i = 1
      while (i < rest.length && textWidth(rest.slice(0, i + 1), FS_NAME) <= MAX_LINE_W) i++
      lines.push(rest.slice(0, i))
      rest = rest.slice(i)
    }
    if (!rest) continue
    const cand = cur ? `${cur} ${rest}` : rest
    if (textWidth(cand, FS_NAME) <= MAX_LINE_W) cur = cand
    else { lines.push(cur); cur = rest }
  }
  if (cur) lines.push(cur)
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES)
    kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1]}…`
    return kept
  }
  return lines
}

/** 프로젝트 시간축 위 마일스톤 여정 — 완료/기한경과/예정을 한 줄에. 라벨은 위/아래 교차 배치.
 *  이름은 줄바꿈으로 전부 표시하고, 라벨 중심을 어림 폭 기준으로 안쪽에 클램프해 가장자리 잘림을 막는다.
 *  높이는 위/아래 최대 줄 수에 맞춰 동적으로 계산한다. */
export async function MilestoneTimeline({ points, startDate, endDate, today }: {
  points: MilestonePoint[]; startDate: string | null; endDate: string | null; today: string
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (points.length === 0) {
    return (
      <SectionCard eyebrow="MILESTONES" title={tr('dash.ms.title')} icon={Flag}>
        <MiniEmpty text={tr('dash.ms.empty')} />
      </SectionCard>
    )
  }

  let axisStart = startDate ?? points[0].date
  let axisEnd = endDate ?? points[points.length - 1].date
  if (axisStart >= axisEnd) { axisStart = addDaysCal(axisStart, -14); axisEnd = addDaysCal(axisEnd, 14) }
  const total = diffDaysCal(axisStart, axisEnd)
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(axisStart, d))) / total) * (W - PL - PR)
  const clampX = (cx: number, halfW: number) => Math.min(Math.max(cx, halfW + 2), W - halfW - 2)
  const todayIn = today >= axisStart && today <= axisEnd

  const wrapped = points.map(p => wrapName(p.name))
  const subs = points.map(p =>
    p.status === 'upcoming' ? `${fmtDate(p.date)} · D-${p.dday}`
    : p.status === 'overdue' ? `${fmtDate(p.date)} · ${tr('dash.ms.overdueBadge')}`
    : fmtDate(p.date))
  const maxAbove = wrapped.reduce((m, l, i) => (i % 2 === 0 ? Math.max(m, l.length) : m), 0)
  const maxBelow = wrapped.reduce((m, l, i) => (i % 2 === 1 ? Math.max(m, l.length) : m), 0)

  // 라벨 중심 x 사전 계산 — 가장자리 클램프 후, 같은 쪽 직전 라벨과 겹치면 오른쪽으로 민다
  // (points 는 날짜 오름차순이므로 좌→우 스윕). 오른쪽 끝에서는 경계가 우선이라 극단적 밀집에선 겹침이 남을 수 있다.
  const GAP = 8
  const lastRight = { above: -Infinity, below: -Infinity }
  const labelX = points.map((p, i) => {
    const halfW = Math.max(...wrapped[i].map(l => textWidth(l, FS_NAME)), textWidth(subs[i], FS_SUB)) / 2
    const side = i % 2 === 0 ? 'above' as const : 'below' as const
    const lx = clampX(Math.max(x(p.date), lastRight[side] + GAP + halfW), halfW)
    lastRight[side] = lx + halfW
    return lx
  })

  // 세로 배치: [오늘 라벨][위 이름 블록][위 날짜행] BASE(축) [아래 이름 블록][아래 날짜행]
  const TOP = todayIn ? 20 : 8
  const BASE = TOP + (maxAbove ? 36 + LH * (maxAbove - 1) : 20)
  const H = BASE + (maxBelow ? 45 + LH * (maxBelow - 1) : 20)
  const todayLabelX = todayIn ? clampX(x(today), textWidth(fmtDate(today), FS_SUB) / 2) : 0

  return (
    <SectionCard
      eyebrow="MILESTONES" title={tr('dash.ms.title')} icon={Flag}
      actions={<CountBadge n={points.length} unit={tr('dash.unitCount')} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={tr('dash.ms.title')}>
        <line x1={PL} x2={W - PR} y1={BASE} y2={BASE} className="stroke-line" strokeWidth={2} />
        {todayIn && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={TOP - 2} y2={H - 6} className="stroke-delayed" strokeWidth={1} strokeDasharray="2 3" />
            <text x={todayLabelX} y={12} textAnchor="middle" fontSize={FS_SUB} className="fill-ink-subtle">{fmtDate(today)}</text>
          </g>
        )}
        {points.map((p, i) => {
          const lines = wrapped[i]
          const sub = subs[i]
          const above = i % 2 === 0
          const lx = labelX[i]
          // 위쪽은 날짜행(BASE-14) 위로 이름 줄을 아래→위로 쌓고, 아래쪽은 이름 줄 아래에 날짜행을 둔다.
          const nameY = (j: number) => (above ? BASE - 26 - LH * (lines.length - 1 - j) : BASE + 24 + LH * j)
          const dateY = above ? BASE - 14 : BASE + 24 + LH * (lines.length - 1) + 13
          return (
            <g key={p.id}>
              <circle cx={x(p.date)} cy={BASE} r={5}
                className={i > 0 && p.date <= today && p.status !== 'overdue' ? 'fill-delayed' : MS_TONE[p.status]}>
                <title>{`${p.name} · ${fmtDate(p.date)}`}</title>
              </circle>
              {lines.map((line, j) => (
                <text key={j} x={lx} y={nameY(j)} textAnchor="middle" fontSize={FS_NAME} className="fill-ink font-medium">{line}</text>
              ))}
              <text x={lx} y={dateY} textAnchor="middle" fontSize={FS_SUB}
                className={p.status === 'overdue' ? 'fill-delayed' : 'fill-ink-subtle'}>
                {sub}
              </text>
            </g>
          )
        })}
      </svg>
    </SectionCard>
  )
}
