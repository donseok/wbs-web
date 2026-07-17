import { Users } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { teamProgress } from '@/lib/domain/dashboard'
import { collectLeaves } from '@/lib/domain/tree'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { TEAM } from '@/components/wbs/shared'

/** 팀별 진척 — 주간 보고서 모달의 By owner 섹션과 같은 정의(teamProgress)를 대시보드에 상설 노출.
 *  담당 없는 팀은 바 0 + '-' 표기(0%와 구분). */
export function TeamProgress({ items }: { items: ComputedItem[] }) {
  const rows = teamProgress(collectLeaves(items))

  return (
    <SectionCard eyebrow="BY OWNER" title="팀별 진척" icon={Users}>
      <div className="space-y-4">
        {rows.map(s => (
          <div key={s.team} className="flex items-center gap-3">
            <span className="flex w-14 shrink-0 items-center gap-2 text-sm font-semibold text-ink">
              <span className={`h-2 w-2 rounded-full ${TEAM[s.team].bar}`} />
              {s.team}
            </span>
            <span className="w-20 shrink-0 text-xs text-ink-subtle">{s.count}개 작업</span>
            <div className="flex-1">
              <ProgressBar value={s.pct ?? 0} tone={TEAM[s.team].bar} label={`${s.team} 진척 ${s.pct ?? 0}%`} />
            </div>
            <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
              {s.pct == null ? '-' : `${s.pct}%`}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
