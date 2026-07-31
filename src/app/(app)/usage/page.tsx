import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { PageHero } from '@/components/ui/PageHero'
import { PeriodTabs } from '@/components/usage/PeriodTabs'
import { UsageSummary } from '@/components/usage/UsageSummary'
import { UsageTrendChart } from '@/components/usage/UsageTrendChart'
import { MenuRankingCard } from '@/components/usage/MenuRankingCard'
import { UsageUserTable } from '@/components/usage/UsageUserTable'
import { UsageEventLog } from '@/components/usage/UsageEventLog'
import { getServerLocale } from '@/lib/i18n/server'
import {
  SESSION_GAP_MINUTES, USAGE_RETAIN_DAYS, addDaysIso, fillDailySeries, mergeUserRows,
  parsePeriodDays, pickAllowed,
} from '@/lib/domain/usage'
import { USAGE_MENUS } from '@/lib/domain/usageMenu'
import {
  getDailyActives, getMenuRanking, getRecentUsageEvents, getUsageDirectory,
  getUsageSessions, getUsageSummary, getUserRollup, purgeOldUsageEvents,
} from '@/lib/data/usage'
import { seoulToday } from '@/lib/domain/dates'

export const dynamic = 'force-dynamic' // 접속 지표는 항상 최신이어야 한다

/** 접속 로그 표시 상한. 넘치면 화면이 그 사실을 밝힌다. */
const EVENT_LIMIT = 200

export default async function UsagePage({ searchParams }: {
  searchParams: Promise<{ days?: string; user?: string; menu?: string }>
}) {
  // 슈퍼유저 전용 — 판정은 canViewUsage 한 곳에서. 어포던스(사이드바 링크)도 같은 판정을 쓴다.
  const actor = await getActorForView()
  if (!canViewUsage(actor)) redirect('/projects')

  const [{ days, user, menu }, locale] = await Promise.all([searchParams, getServerLocale()])
  const period = parsePeriodDays(days)
  const today = seoulToday()
  const from = addDaysIso(today, -(period - 1))
  // 메뉴 필터는 여기서 검증 가능하지만 사용자 필터는 계정 목록을 받아야 한다(아래 2단계).
  const menuFilter = pickAllowed(menu, USAGE_MENUS.map(x => x.key))

  // 단일 왕복 — 직렬 2단째를 만들지 않는다(대시보드 관례).
  const [summary, daily, ranks, rollup, directory, sessions] = await Promise.all([
    getUsageSummary(from, today, today),
    getDailyActives(from, today),
    getMenuRanking(from, today),
    getUserRollup(from, today),
    getUsageDirectory(),
    getUsageSessions(from, today, SESSION_GAP_MINUTES),
  ])

  // 사용자 필터는 실재하는 계정 id 만 허용한다 — 검증 없이 넘기면 존재하지 않는 id 로
  // 영원히 빈 표가 나오고 그게 '기록 없음'과 구별되지 않는다.
  const userFilter = pickAllowed(user, directory.map(a => a.id))
  const events = await getRecentUsageEvents({
    from, to: today, limit: EVENT_LIMIT, userId: userFilter, menuKey: menuFilter,
  })

  const series = fillDailySeries(daily, from, today)
  const userRows = mergeUserRows(directory, rollup)
  const names = new Map(directory.map(a => [a.id, a.name]))
  const filter = { days: period, user: userFilter, menu: menuFilter }

  // 프로미스를 반환한다 — void 로 버리면 Next 가 waitUntil 로 추적하지 못해
  // 응답 직후 인스턴스가 얼면 DELETE 왕복이 끊긴다(리포의 다른 after() 9곳과 동일 형태).
  after(() => purgeOldUsageEvents())

  return (
    <div className="space-y-6">
      <PageHero eyebrow="OPERATIONS" title="사용 현황" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          최근 {period}일 · 원시 기록은 {USAGE_RETAIN_DAYS}일간 보관됩니다.
        </p>
        <PeriodTabs filter={filter} />
      </div>
      <UsageSummary summary={summary} days={period} sessions={sessions} />
      <div className="grid gap-5 lg:grid-cols-2">
        <UsageTrendChart series={series} />
        <MenuRankingCard ranks={ranks} locale={locale} />
      </div>
      <UsageUserTable rows={userRows} days={period} />
      <UsageEventLog events={events} names={names} limit={EVENT_LIMIT} locale={locale}
        menus={ranks.map(r => r.menuKey)} filter={filter} />
    </div>
  )
}
