import { NotebookText } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMinutesPage } from '@/lib/data/minutes'
import { getMembership, getSession } from '@/lib/auth'
import { getUiPrefs } from '@/app/actions/preferences'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { MinutesView } from '@/components/minutes/MinutesView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
/** 해당 월 1일~말일 (달력 그리드 아님 — 목록은 월 단위 조회). */
function monthRange(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]
}

export default async function MinutesPage() {
  const today = seoulToday()
  const [rs, re] = monthRange(today)
  const [minutes, m, user, prefs, projects, locale] = await Promise.all([
    getMinutesPage(rs, re, null),
    getMembership(),
    getSession(),
    getUiPrefs(),
    listProjects(),
    getServerLocale(),
  ])
  // prefs에 미지 값(구버전 롤백·스큐)이 남아도 빈 화면이 되지 않게 화이트리스트로 클램프
  const savedView = prefs.minutesView
  const initialView = savedView === 'calendar' || savedView === 'tree' ? savedView : 'list'
  return (
    <ProjectPageShell
      hero={<PageHero
        eyebrow="MINUTES"
        badge={<HeroBadge>Minutes</HeroBadge>}
        title={t(locale, 'min.heroTitle')}
        description={t(locale, 'min.heroDesc')}
        heroKpis={<KpiCard variant="hero" label="THIS MONTH" value={minutes.length}
          sub={t(locale, 'min.kpi.monthSub')} icon={NotebookText} tone="brand" />}
      />}
    >
      <MinutesView initialMinutes={minutes} todayIso={today}
        initialView={initialView} projects={projects} defaultTeam={m?.teamCode ?? null}
        currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
