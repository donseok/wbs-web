import { ScrollText } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import { menuLabel } from '@/lib/domain/usageMenu'
import type { UsageEventRow } from '@/lib/data/usage'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date(iso))
}

/** 접속 로그 — 최신순. 상한에 걸리면 그 사실을 화면에 밝힌다(잘린 목록을 전부처럼 보이지 않게). */
export function UsageEventLog({ events, names, limit, locale }: {
  events: UsageEventRow[]; names: Map<string, string>; limit: number; locale: Locale
}) {
  const translate = (k: DictKey) => t(locale, k)
  return (
    <SectionCard eyebrow="ACCESS LOG" title="접속 로그" icon={ScrollText}
      actions={events.length >= limit
        ? <span className="badge bg-pending-weak text-pending">최근 {limit}건만 표시</span>
        : <span className="badge bg-brand-weak text-brand">{events.length}건</span>}>
      {events.length === 0 ? (
        <MiniEmpty text="이 기간에 기록된 접속이 없습니다." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <th className="py-2 pr-3 text-left">시각</th>
                <th className="py-2 pr-3 text-left">사용자</th>
                <th className="py-2 pr-3 text-left">메뉴</th>
                <th className="py-2 pr-3 text-left">경로</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDateTime(e.occurredAt)}</td>
                  {/* 계정 목록에 없는 id 는 이름을 지어내지 않는다 */}
                  <td className="py-2 pr-3 text-ink">{names.get(e.userId) ?? '확인 불가'}</td>
                  <td className="py-2 pr-3 text-ink-muted">{menuLabel(e.menuKey, translate)}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-ink-subtle">{e.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
