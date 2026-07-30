import { BarChart3 } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import { menuLabel } from '@/lib/domain/usageMenu'
import { barPct, type MenuRank } from '@/lib/domain/usage'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

/** 많이 쓰는 프로그램(메뉴) — 조회수 순. 막대는 1위 대비 비율. */
export function MenuRankingCard({ ranks, locale }: { ranks: MenuRank[]; locale: Locale }) {
  const translate = (k: DictKey) => t(locale, k)
  const max = ranks[0]?.events ?? 0

  return (
    <SectionCard eyebrow="MENUS" title="많이 쓰는 프로그램" icon={BarChart3}>
      {ranks.length === 0 ? (
        <MiniEmpty text="수집 시작 이후 데이터가 쌓입니다." />
      ) : (
        <ol className="space-y-2">
          {ranks.map((r, i) => (
            <li key={r.menuKey} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-subtle">{i + 1}</span>
              <span className="w-32 shrink-0 truncate text-xs text-ink">{menuLabel(r.menuKey, translate)}</span>
              <span className="h-2 min-w-0 flex-1 rounded-full bg-surface-2">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${barPct(r.events, max)}%` }} />
              </span>
              <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
                {r.events.toLocaleString('ko-KR')}회 · {r.activeUsers}명
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}
