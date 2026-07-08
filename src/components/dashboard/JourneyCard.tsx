import { TrendingUp } from 'lucide-react'
import type { JourneyModel } from '@/lib/domain/journey'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { MiniEmpty } from './primitives'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/* 좌표계 — 도메인의 x(0~1)를 여기서만 픽셀로 바꾼다. */
const VB_W = 320, VB_H = 148
const PLOT_X0 = 20, PLOT_W = 292        // 왼쪽에 y축 라벨 자리
const PLOT_Y0 = 8, PLOT_H = 72          // 100% → y=8, 0% → y=80
const BAND_Y0 = 100, BAND_H = 5, BAND_GAP = 2.4
const MS_Y = 92
/** 편차가 0에 가까워도 눈에 보이도록 보장하는 최소 스텁 길이(px). */
const MIN_STUB = 14

const px = (x: number) => PLOT_X0 + x * PLOT_W
const py = (pct: number) => PLOT_Y0 + (1 - pct / 100) * PLOT_H

export async function JourneyCard({ model }: { model: JourneyModel | null }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  // EmptyState는 자체 .card를 렌더하므로 SectionCard 안에 넣으면 카드가 겹친다. MiniEmpty를 쓴다.
  if (!model) {
    return (
      <SectionCard eyebrow="JOURNEY" title={tr('dash.journey.title')} icon={TrendingUp} fill>
        <MiniEmpty text={tr('dash.journey.noSchedule')} />
      </SectionCard>
    )
  }

  const { curve, bands, milestones, todayX, actual, planned, variance, forecast, earlyFloorX, elapsed, earlyFloor } = model
  const line = curve.map(p => `${px(p.x).toFixed(1)},${py(p.planned).toFixed(1)}`).join(' L')
  const area = `M${line} L${px(1).toFixed(1)},${py(0)} L${px(0).toFixed(1)},${py(0)} Z`

  // 가장 긴 단계 = 계획이 몰려 있는 구간. 경영진이 봐야 할 한 문장.
  const heaviest = bands.length ? bands.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a)) : null

  const behind = variance < 0
  const varianceText = `${variance >= 0 ? '+' : ''}${variance}%p`

  /* 편차 스텁 — y는 아래로 갈수록 크다.
     뒤처지면(py(actual) > py(planned)) 아래로, 앞서면 위로 뻗어야 한다.
     한쪽으로만 MIN_STUB을 강제하면 앞선 프로젝트가 늦은 것처럼 그려진다.
     편차 0이면 길이 0이므로 아예 그리지 않는다.
     끝을 플롯 영역 [py(100), py(0)]로 클램프한다 — 바닥/천장 근처에서 MIN_STUB이
     스텁을 축 밖으로 밀어 마일스톤 행(MS_Y)·단계 띠(BAND_Y0)를 침범하지 않도록.
     레이아웃 정확성이 MIN_STUB 가시성 휴리스틱보다 우선이며, 바닥 근처의 짧은 스텁은
     실제 편차가 작다는 정직한 표현이다. */
  const stubFrom = behind
    ? Math.min(Math.max(py(actual), py(planned) + MIN_STUB), py(0))
    : Math.max(Math.min(py(actual), py(planned) - MIN_STUB), py(100))

  return (
    <SectionCard
      eyebrow="JOURNEY"
      title={tr('dash.journey.title')}
      icon={TrendingUp}
      fill
      actions={
        <span className="tabular-nums text-[11px] text-ink-muted">
          {tr('dash.actualLabel')} {actual}% / {tr('dash.plannedLabel')} {planned}%
          {/* Tailwind는 소스의 '리터럴' 클래스 문자열만 스캔한다. `text-${tone}` 같은 조립형은
              유틸리티가 아예 생성되지 않으므로, 반드시 양쪽 분기를 완전한 리터럴로 쓴다. */}
          <strong className={behind ? 'ml-1.5 text-delayed' : 'ml-1.5 text-done'}>{varianceText}</strong>
        </span>
      }
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full overflow-visible" role="img"
        aria-label={`${tr('dash.actualLabel')} ${actual}%, ${tr('dash.plannedLabel')} ${planned}%, ${varianceText}`}>
        <defs>
          <linearGradient id="journeyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
          <pattern id="journeyHatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="4" className="stroke-line-strong" strokeWidth="1.4" />
          </pattern>
        </defs>

        {/* 격자 */}
        <g className="stroke-line" strokeWidth="0.5">
          <line x1={PLOT_X0} y1={py(0)} x2={px(1)} y2={py(0)} />
          <line x1={PLOT_X0} y1={py(50)} x2={px(1)} y2={py(50)} />
          <line x1={PLOT_X0} y1={py(100)} x2={px(1)} y2={py(100)} />
        </g>
        <g className="fill-ink-subtle" fontSize="5">
          <text x="0" y={py(100) + 2}>100</text>
          <text x="4" y={py(50) + 2}>50</text>
          <text x="8" y={py(0) + 2}>0</text>
        </g>

        {/* 가장 긴 단계 음영 — "계획이 여기 몰려 있다" */}
        {heaviest && (
          <>
            <rect x={px(heaviest.x0)} y={PLOT_Y0} width={px(heaviest.x1) - px(heaviest.x0)} height={PLOT_H}
              className="fill-brand" opacity="0.06" />
            <text x={px(heaviest.x0) + 2} y={PLOT_Y0 + 6} fontSize="4.4" className="fill-brand" opacity="0.75">
              {heaviest.name}
            </text>
          </>
        )}

        {/* 계획 누적 곡선 */}
        <path d={area} fill="url(#journeyFill)" />
        <path d={`M${line}`} fill="none" className="stroke-brand" strokeWidth="1.5" />

        {/* 예측 산정 시작 눈금 (early 구간에만) */}
        {earlyFloorX != null && (
          <>
            <line x1={px(earlyFloorX)} y1={PLOT_Y0 + 4} x2={px(earlyFloorX)} y2={py(0)}
              className="stroke-ink-subtle" strokeWidth="0.6" strokeDasharray="1.5 2" />
            <text x={px(earlyFloorX) + 2} y={PLOT_Y0 + 9} fontSize="4.4" className="fill-ink-subtle">
              {tr('dash.journey.forecastPending')} · D+{elapsed} / {earlyFloor}
            </text>
          </>
        )}

        {/* 예측 점선 — projectedEnd가 있을 때만 그린다.
            꺾쇠는 clipped로 판단한다. x===1 이어도 종료일에 정확히 닿으면 clipped=false다. */}
        {forecast && (
          <>
            <path d={`M${px(todayX)},${py(actual)} L${px(forecast.x)},${py(100)}`}
              fill="none" className="stroke-accent-secondary" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
            {forecast.clipped && (
              <text x={px(1) - 2} y={py(100) - 3} fontSize="4.6" textAnchor="end" className="fill-accent-secondary">
                +{forecast.slipDays}{tr('dash.unitDays')} →
              </text>
            )}
          </>
        )}

        {/* 오늘 선 */}
        <line x1={px(todayX)} y1={PLOT_Y0 - 4} x2={px(todayX)} y2={py(0) + 4}
          className="stroke-today" strokeWidth="0.8" strokeDasharray="2 2" />

        {/* 편차 스텁 — 부호에 따라 위/아래. 편차 0이면 그리지 않는다. */}
        {variance !== 0 && (
          <line x1={px(todayX)} y1={stubFrom} x2={px(todayX)} y2={py(planned)}
            className={behind ? 'stroke-delayed' : 'stroke-done'} strokeWidth="2.2" opacity="0.55" />
        )}

        <circle cx={px(todayX)} cy={py(planned)} r="1.7" fill="none" className="stroke-brand" strokeWidth="0.9" />
        <circle cx={px(todayX)} cy={py(actual)} r="2.3" className={behind ? 'fill-delayed' : 'fill-done'} />
        <text x={px(todayX) + 4} y={py(actual) + 1.5} fontSize="5" className="fill-ink-muted">{varianceText}</text>

        {/* 마일스톤 다이아몬드 */}
        {milestones.map(m => (
          <path key={m.id} d={`M${px(m.x)},${MS_Y} l2.3,2.3 -2.3,2.3 -2.3,-2.3 Z`}
            className={m.done ? 'fill-done' : 'fill-accent-warning'}>
            <title>{`${m.name} · ${fmtDate(m.date)}`}</title>
          </path>
        ))}

        {/* 단계 띠 — 기하는 계획 기간, 채움은 롤업 plannedPct. 미착수는 빗금. */}
        {bands.map((b, i) => {
          const y = BAND_Y0 + i * (BAND_H + BAND_GAP)
          const w = Math.max(1, px(b.x1) - px(b.x0))
          // 띠가 오른쪽 끝까지 뻗으면 라벨을 왼쪽 안쪽에 그린다.
          const labelRight = px(b.x1) + 3 > VB_W - 40
          return (
            <g key={b.id}>
              <rect x={px(b.x0)} y={y} width={w} height={BAND_H} rx={BAND_H / 2}
                className={b.started ? 'fill-phasebar' : ''}
                fill={b.started ? undefined : 'url(#journeyHatch)'} opacity={b.started ? 0.3 : 1} />
              {b.started && (
                <rect x={px(b.x0)} y={y} width={(w * b.fillPct) / 100} height={BAND_H} rx={BAND_H / 2} className="fill-brand" />
              )}
              <text
                x={labelRight ? px(b.x0) - 3 : px(b.x1) + 3}
                textAnchor={labelRight ? 'end' : 'start'}
                y={y + BAND_H - 0.6} fontSize="4.4" className="fill-ink-muted"
              >
                {b.name}{b.started ? ` ${b.fillPct}%` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </SectionCard>
  )
}
