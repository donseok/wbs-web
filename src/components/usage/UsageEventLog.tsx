import Link from 'next/link'
import { ScrollText, X } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from '@/components/dashboard/bits'
import { menuLabel } from '@/lib/domain/usageMenu'
import { usageHref } from '@/lib/domain/usage'
import type { UsageEventRow } from '@/lib/data/usage'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date(iso))
}

/**
 * 접속 로그 — 최신순. 상한에 걸리면 그 사실을 화면에 밝힌다(잘린 목록을 전부처럼 보이지 않게).
 * 필터는 searchParams 기반 링크다 — 클라이언트 상태가 없어야 서버 렌더 한 번으로 끝난다.
 */
export function UsageEventLog({ events, names, limit, locale, menus, filter }: {
  events: UsageEventRow[]
  names: Map<string, string>
  limit: number
  locale: Locale
  /** 이 기간에 실제로 기록이 있는 메뉴 키(사용량 순) — 없는 메뉴로 필터를 걸 수 없게 한다. */
  menus: string[]
  filter: { days: number; user?: string; menu?: string }
}) {
  const translate = (k: DictKey) => t(locale, k)
  const chip = (active: boolean) =>
    `chip ${active ? 'bg-brand text-white' : 'text-ink-muted transition hover:text-ink'}`

  return (
    <SectionCard eyebrow="ACCESS LOG" title="접속 로그" icon={ScrollText}
      actions={events.length >= limit
        ? <span className="badge bg-pending-weak text-pending">최근 {limit}건만 표시</span>
        : <span className="badge bg-brand-weak text-brand">{events.length}건</span>}>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={usageHref(filter, { menu: undefined })} className={chip(!filter.menu)}>전체 메뉴</Link>
        {menus.map(k => (
          <Link key={k} href={usageHref(filter, { menu: k })} className={chip(filter.menu === k)}>
            {menuLabel(k, translate)}
          </Link>
        ))}
        {filter.user && (
          <Link href={usageHref(filter, { user: undefined })}
            className="chip ml-auto bg-brand-weak text-brand transition hover:bg-brand hover:text-white">
            {names.get(filter.user) ?? '확인 불가'} <X className="ml-1 h-3 w-3" />
          </Link>
        )}
      </div>
      {events.length === 0 ? (
        <MiniEmpty text={filter.user || filter.menu
          ? '이 조건에 해당하는 접속 기록이 없습니다.'
          : '이 기간에 기록된 접속이 없습니다.'} />
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
                  {/* 계정 목록에 없는 id 는 이름을 지어내지 않는다. 이름 클릭 = 그 사용자로 필터. */}
                  <td className="py-2 pr-3 text-ink">
                    <Link href={usageHref(filter, { user: e.userId })} className="transition hover:text-brand hover:underline">
                      {names.get(e.userId) ?? '확인 불가'}
                    </Link>
                  </td>
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
