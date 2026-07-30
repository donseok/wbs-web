import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { getMembership } from '@/lib/auth'
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
  USAGE_RETAIN_DAYS, addDaysIso, countSessions, fillDailySeries, mergeUserRows, parsePeriodDays,
} from '@/lib/domain/usage'
import {
  getDailyActives, getMenuRanking, getRecentUsageEvents, getUsageDirectory,
  getUsageSummary, getUserRollup, purgeOldUsageEvents,
} from '@/lib/data/usage'

export const dynamic = 'force-dynamic' // 접속 지표는 항상 최신이어야 한다

/** 접속 로그 표시 상한. 넘치면 화면이 그 사실을 밝힌다. */
const EVENT_LIMIT = 200

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function UsagePage({ searchParams }: {
  searchParams: Promise<{ days?: string }>
}) {
  const m = await getMembership()
  // 지금은 전원 통과. 관리자 전용 전환은 canViewUsage 한 곳에서 이뤄진다.
  if (!canViewUsage(m)) redirect('/projects')

  const [{ days }, locale] = await Promise.all([searchParams, getServerLocale()])
  const period = parsePeriodDays(days)
  const today = seoulToday()
  const from = addDaysIso(today, -(period - 1))

  // 단일 왕복 — 직렬 2단째를 만들지 않는다(대시보드 관례).
  const [summary, daily, ranks, rollup, directory, events] = await Promise.all([
    getUsageSummary(from, today, today),
    getDailyActives(from, today),
    getMenuRanking(from, today),
    getUserRollup(from, today),
    getUsageDirectory(),
    getRecentUsageEvents({ from, to: today, limit: EVENT_LIMIT }),
  ])

  const series = fillDailySeries(daily, from, today)
  const userRows = mergeUserRows(directory, rollup)
  const names = new Map(directory.map(a => [a.id, a.name]))
  // 표시된 로그 범위 안에서의 접속 횟수 — 전 구간이 아니라 최근 EVENT_LIMIT 건 기준임을
  // 카드 설명(30분 무활동 기준)과 함께 읽도록 둔다.
  const sessions = countSessions(events.map(e => e.occurredAt))

  after(() => { void purgeOldUsageEvents() })

  return (
    <div className="space-y-6">
      <PageHero eyebrow="OPERATIONS" title="사용 현황" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          최근 {period}일 · 원시 기록은 {USAGE_RETAIN_DAYS}일간 보관됩니다.
        </p>
        <PeriodTabs current={period} />
      </div>
      <UsageSummary summary={summary} days={period} sessions={sessions} />
      <div className="grid gap-5 lg:grid-cols-2">
        <UsageTrendChart series={series} />
        <MenuRankingCard ranks={ranks} locale={locale} />
      </div>
      <UsageUserTable rows={userRows} days={period} />
      <UsageEventLog events={events} names={names} limit={EVENT_LIMIT} locale={locale} />
    </div>
  )
}
