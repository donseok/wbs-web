import { Megaphone, Pin, Sparkles } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getAnnouncements, getAnnouncementSeenAt } from '@/lib/data/announcements'
import { summarizeAnnouncements } from '@/lib/domain/announcements'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function AnnouncementsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [announcements, lastSeenAt, m, projects, locale] = await Promise.all([
    getAnnouncements(projectId),
    getAnnouncementSeenAt(projectId),
    getMembership(),
    listProjects(),
    getServerLocale(),
  ])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'ann.projectFallback')
  const canEdit = m?.role === 'pmo_admin'
  const { total, pinned, recent7d } = summarizeAnnouncements(announcements, seoulToday())

  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="NOTICE"
        badge={<HeroBadge>Announcements</HeroBadge>}
        title={`${projectName} ${t(locale, 'ann.heroTitleSuffix')}`}
        description={t(locale, 'ann.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TOTAL" value={total} sub={t(locale, 'ann.kpi.totalSub')} icon={Megaphone} tone="brand" />
            <KpiCard variant="hero" label="PINNED" value={pinned} sub={t(locale, 'ann.kpi.pinnedSub')} icon={Pin} tone="warning" />
            <KpiCard variant="hero" label="LAST 7 DAYS" value={recent7d} sub={t(locale, 'ann.kpi.recentSub')} icon={Sparkles} tone="success" />
          </>
        }
      />}
    >
      <AnnouncementsView
        announcements={announcements}
        lastSeenAt={lastSeenAt}
        canEdit={canEdit}
        projectId={projectId}
      />
    </ProjectPageShell>
  )
}
