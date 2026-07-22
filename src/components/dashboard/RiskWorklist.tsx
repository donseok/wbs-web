import Link from 'next/link'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { delayAging, diffDaysCal, dueSoonLeaves, riskModel, varianceRanking } from '@/lib/domain/dashboard'
import { collectLeaves } from '@/lib/domain/tree'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'

type Kind = 'overdue' | 'dueSoon' | 'behind'
interface Row { item: ComputedItem; kind: Kind; overdue: number; dday: number; gap: number }

// 임박 배지 문구 — D-0은 '오늘 마감', 그 외 'D-N 임박'. (지연·뒤처짐은 각자 우측 텍스트를 따로 씀)
const ddayText = (n: number) => (n <= 0 ? '오늘 마감' : `D-${n} 임박`)

// 행 스타일 — 지연=빨강 틴트, 임박=주황 틴트로 카드 안에서 즉시 구분. 뒤처짐은 기본 라인.
const ROW_META: Record<Kind, { border: string; icon: string }> = {
  overdue: { border: 'border-delayed/40', icon: 'text-delayed' },
  dueSoon: { border: 'border-accent-warning/40', icon: 'text-accent-warning' },
  behind: { border: 'border-line', icon: 'text-accent-warning' },
}

/** 실행 가능한 리스크 목록 — 요약 타일의 숫자를 실제 WBS 작업으로 연결한다.
 *  기한 경과(지연)·7일 내 마감(임박)·계획 미달(뒤처짐)을 항상 함께 쌓아 보여준다.
 *  배지의 지연 카운트(riskModel)는 status==='delayed' 기준이라 기한 경과분만으로는 설명되지 않는다 —
 *  나머지는 뒤처짐 행이 받아내므로, 뒤처짐을 조건부로 숨기면 배지 숫자가 목록에서 사라진다. */
export function RiskWorklist({ items, projectId, today }: {
  items: ComputedItem[]; projectId: string; today: string
}) {
  const leaves = collectLeaves(items)
  const risk = riskModel(items, today)

  const overdue: Row[] = delayAging(leaves, today, 4).list
    .map(e => ({ item: e.item, kind: 'overdue' as const, overdue: e.overdue, dday: 0, gap: e.gap }))
  const dueSoon: Row[] = dueSoonLeaves(leaves, today).slice(0, 4)
    .map(l => ({ item: l, kind: 'dueSoon' as const, overdue: 0, dday: diffDaysCal(today, l.plannedEnd!), gap: 0 }))

  // 지연·임박은 마감일 기준 상호배타(과거 vs 오늘·미래). 뒤처짐은 임박과 겹칠 수 있어 id로 제외한다.
  const urgent = [...overdue, ...dueSoon]
  const seen = new Set(urgent.map(r => r.item.id))
  const behind: Row[] = varianceRanking(leaves, today, 12)
    .filter(v => !seen.has(v.item.id))
    .slice(0, urgent.length ? 4 : 5)
    .map(v => ({ item: v.item, kind: 'behind' as const, overdue: 0, dday: 0, gap: v.gapPp }))

  const rows: Row[] = [...urgent, ...behind]

  return (
    <SectionCard eyebrow="ACTION QUEUE" title="지금 확인할 작업" icon={AlertTriangle}
      actions={<span className="chip bg-delayed-weak text-delayed">지연 {risk.delayed} · 임박 {risk.dueSoon}</span>}>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">현재 즉시 조치가 필요한 작업이 없습니다.</p> : (
        <div className="space-y-2">
          {rows.map(({ item, kind, overdue, dday, gap }) => {
            const meta = ROW_META[kind]
            const detail = kind === 'overdue' ? `${overdue}일 지연` : kind === 'behind' ? `계획 대비 ${Math.round(gap)}%p 미달` : null
            const aria = kind === 'dueSoon' ? `${item.name}, 마감 임박 ${ddayText(dday)}` : `${item.name}, ${detail}`
            return (
              <Link key={item.id} href={`/p/${projectId}/wbs?focus=${item.id}`} aria-label={aria}
                className={`flex items-center gap-3 rounded-xl border ${meta.border} px-3 py-2.5 hover:bg-surface-2`}>
                <CalendarClock className={`h-4 w-4 shrink-0 ${meta.icon}`} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.name}</span>
                {kind === 'dueSoon'
                  ? <span className="chip shrink-0 bg-accent-warning/10 font-semibold text-accent-warning">{ddayText(dday)}</span>
                  : <span className="shrink-0 text-xs text-ink-muted">{detail}</span>}
                {item.plannedEnd && <span className="shrink-0 text-xs text-ink-subtle">{fmtDate(item.plannedEnd)}</span>}
              </Link>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
