import { CalendarDays, Eye, FileText } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMinutes } from '@/lib/data/minutes'
import { getTeams } from '@/lib/data/teams'
import { summarizeMinutes } from '@/lib/domain/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MinutesView } from '@/components/minutes/MinutesView'

/** 오늘 'YYYY-MM-DD' (Asia/Seoul). 앱 날짜 표기 관례 — 각 page.tsx 가 로컬로 갖는다. */
function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function MinutesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [minutes, teams, membership, user, projects, locale] = await Promise.all([
    getProjectMinutes(projectId),
    getTeams(),
    getMembership(),
    getSession(),
    listProjects(),
    getServerLocale(),
  ])

  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''
  const suffix = t(locale, 'min.heroTitleSuffix')
  // projectName 이 비면 `${''} ${suffix}` 가 앞 공백을 남긴다 — 제목은 truncate 되는 한 줄이라 눈에 띈다.
  const heroTitle = projectName ? `${projectName} ${suffix}` : suffix

  const { total, thisMonth, viewable } = summarizeMinutes(minutes, seoulToday())

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MINUTES"
        badge={<HeroBadge>Meeting Minutes</HeroBadge>}
        title={heroTitle}
        description={t(locale, 'min.heroDesc')}
        // PageHero 는 제목 한 줄만 렌더하고 heroKpis 를 의도적으로 버린다(PageHero.tsx:3-7).
        // 그래도 넘긴다 — announcements/dashboard 등 모든 형제 페이지가 같은 관례를 지키고 있어,
        // 히어로가 KPI 를 되살리는 날 이 페이지만 빠지지 않게 하려는 것이다. 여기서 고치지 않는다.
        heroKpis={
          <>
            <KpiCard variant="hero" label={t(locale, 'min.kpi.total')} value={total} sub={t(locale, 'min.kpi.totalSub')} icon={FileText} tone="brand" />
            <KpiCard variant="hero" label={t(locale, 'min.kpi.thisMonth')} value={thisMonth} sub={t(locale, 'min.kpi.thisMonthSub')} icon={CalendarDays} tone="success" />
            <KpiCard variant="hero" label={t(locale, 'min.kpi.viewable')} value={viewable} sub={t(locale, 'min.kpi.viewableSub')} icon={Eye} tone="warning" />
          </>
        }
      />}
    >
      <MinutesView
        projectId={projectId}
        initial={minutes}
        teams={teams}
        membership={membership}
        userId={user?.id ?? null}
      />
    </ProjectPageShell>
  )
}
