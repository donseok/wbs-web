'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LineChart, Camera } from 'lucide-react'
import type { ProgressSnapshot } from '@/lib/domain/types'
import { SectionCard } from '@/components/ui/SectionCard'
import { captureSnapshot } from '@/app/actions/snapshots'
import { fmtDate } from '@/components/wbs/shared'

const W = 600
const H = 160
const PAD_X = 10
const PAD_Y = 14

/** 진척 추세 — 스냅샷별 전체 실적%/계획% 라인 차트 + 스냅샷 저장 버튼(PMO). */
export function TrendCard({
  projectId, snapshots, canCapture,
}: {
  projectId: string
  snapshots: ProgressSnapshot[]
  canCapture: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const n = snapshots.length
  const x = (i: number) => (n <= 1 ? W / 2 : PAD_X + (i / (n - 1)) * (W - 2 * PAD_X))
  const y = (v: number) => H - PAD_Y - (Math.min(100, Math.max(0, v)) / 100) * (H - 2 * PAD_Y)
  const pts = (key: 'actual' | 'planned') => snapshots.map((s, i) => `${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ')

  const latest = snapshots[n - 1]

  function capture() {
    startTransition(async () => {
      const res = await captureSnapshot(projectId)
      setMsg(res.ok ? '현재 진척을 스냅샷으로 저장했습니다.' : (res.error ?? '저장 실패'))
      if (res.ok) router.refresh()
    })
  }

  const captureBtn = canCapture ? (
    <button onClick={capture} disabled={pending} className="btn btn-ghost h-9 px-3 text-xs">
      <Camera className="h-3.5 w-3.5" /> {pending ? '저장 중…' : '스냅샷 저장'}
    </button>
  ) : undefined

  return (
    <SectionCard eyebrow="TREND" title="진척 추세" icon={LineChart} actions={captureBtn}>
      {n < 2 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <LineChart className="h-7 w-7 text-ink-subtle" aria-hidden />
          <p className="text-sm text-ink-muted">추세를 표시하려면 스냅샷이 2개 이상 필요합니다.</p>
          <p className="text-[12px] text-ink-subtle">{canCapture ? '‘스냅샷 저장’으로 현재 진척을 기록하세요.' : 'PMO 관리자가 스냅샷을 저장하면 추세가 표시됩니다.'}</p>
          {msg && <p className="mt-1 text-[12px] text-brand">{msg}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-[12px]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-brand" />실적 {latest.actual}%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-ink-subtle/50" />계획 {latest.planned}%</span>
            <span className="ml-auto text-ink-subtle">{snapshots.length}개 스냅샷 · 최근 {fmtDate(latest.capturedOn)}</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="진척 추세 차트">
            {[0, 50, 100].map(g => (
              <g key={g}>
                <line x1={PAD_X} x2={W - PAD_X} y1={y(g)} y2={y(g)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={0} y={y(g) - 2} fontSize="9" fill="var(--color-ink-subtle)">{g}</text>
              </g>
            ))}
            <polyline points={pts('planned')} fill="none" stroke="var(--color-ink-subtle)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="4 4" />
            <polyline points={pts('actual')} fill="none" stroke="var(--color-brand)" strokeWidth={2.5} />
            {snapshots.map((s, i) => (
              <circle key={s.id} cx={x(i)} cy={y(s.actual)} r={3} fill="var(--color-brand)" />
            ))}
          </svg>
          {msg && <p className="text-[12px] text-brand">{msg}</p>}
        </div>
      )}
    </SectionCard>
  )
}
