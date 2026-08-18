import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import { createServerClient } from '@/lib/supabase/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { getPortfolioInputs } from '@/lib/data/portfolio'
import { buildPortfolio } from '@/lib/domain/portfolio'
import { PageHero } from '@/components/ui/PageHero'
import { PortfolioKpis } from '@/components/portfolio/PortfolioKpis'
import { PortfolioTable } from '@/components/portfolio/PortfolioTable'
import { PortfolioMilestoneBoard } from '@/components/portfolio/PortfolioMilestoneBoard'
import { getServerLocale } from '@/lib/i18n/server'
import { t } from '@/lib/i18n/dict'
import { seoulToday } from '@/lib/domain/dates'

export const dynamic = 'force-dynamic' // 전사 비교 화면은 항상 최신이어야 한다

export default async function PortfolioPage() {
  // 슈퍼유저 전용 — 판정은 canViewPortfolio 한 곳에서. 사이드바 어포던스도 같은 판정을 쓴다.
  const actor = await getActorForView()
  if (!canViewPortfolio(actor)) redirect('/projects')

  const [{ inputs, leadersDegraded, listDegraded }, locale] = await Promise.all([
    getPortfolioInputs(), getServerLocale(),
  ])
  const model = buildPortfolio(inputs)

  // 포트폴리오 조회를 스냅샷 기회로 — 아무도 열지 않는 프로젝트의 이력 공백을 메운다.
  // after() 안에서는 cookies() 불가라 client 를 밖에서 만들어 넘긴다(recordProgressSnapshot 관례).
  const sb = await createServerClient()
  after(() => Promise.all(inputs.map(i => recordProgressSnapshot(i.projectId, sb))))

  return (
    <div className="space-y-6 pb-10">
      <PageHero title={t(locale, 'pf.title')} />
      {listDegraded && (
        <div className="rounded-xl border border-delayed/40 bg-delayed-weak px-4 py-3 text-xs font-medium text-delayed">
          {t(locale, 'pf.listDegraded')}
        </div>
      )}
      <PortfolioKpis totals={model.totals} locale={locale} />
      <PortfolioTable rows={model.rows} leadersDegraded={leadersDegraded} locale={locale} />
      {/* 통합 축의 오늘 마커는 실제 오늘 — 행별 마일스톤 상태(dday)는 각 프로젝트 today 로 이미 판정됨 */}
      <PortfolioMilestoneBoard rows={model.rows} milestones={model.milestones} today={seoulToday()} locale={locale} />
    </div>
  )
}
