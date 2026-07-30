import { TrendingUp } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import type { DailyActive } from '@/lib/domain/usage'

const W = 640, H = 200, PL = 30, PR = 12, PT = 12, PB = 24

/** 일별 활성 사용자 추이 — 자체 SVG(의존성 0). 색은 토큰 클래스라 다크모드 자동. */
export function UsageTrendChart({ series }: { series: DailyActive[] }) {
  const max = Math.max(1, ...series.map(p => p.activeUsers))
  const hasAny = series.some(p => p.events > 0)
  const x = (i: number) => PL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (W - PL - PR))
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB)
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.activeUsers).toFixed(1)}`).join(' ')

  return (
    <SectionCard eyebrow="TREND" title="일별 활성 사용자" icon={TrendingUp}>
      {!hasAny ? (
        <MiniEmpty text="수집 시작 이후 데이터가 쌓입니다." />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="일별 활성 사용자 추이">
          {[0, max].map(g => (
            <g key={g}>
              <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} className="stroke-line" strokeWidth={1} />
              <text x={PL - 6} y={y(g) + 3} textAnchor="end" fontSize={9} className="fill-ink-subtle">{g}</text>
            </g>
          ))}
          <polyline points={points} fill="none" className="stroke-brand" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <text x={PL} y={H - 6} fontSize={9} className="fill-ink-subtle">{series[0]?.d ?? ''}</text>
          <text x={W - PR} y={H - 6} textAnchor="end" fontSize={9} className="fill-ink-subtle">{series[series.length - 1]?.d ?? ''}</text>
        </svg>
      )}
    </SectionCard>
  )
}
