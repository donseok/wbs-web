import { NotebookText } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getMinutesPage, getMinutesTree } from '@/lib/data/minutes'
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
  // 트리는 기본 뷰라 거의 항상 필요하다 — 예전에는 MinutesView 가 마운트 뒤 서버액션으로 따로
  // 가져와서 "화면이 뜨고 나서 또 로딩이 도는" 왕복이 한 번 더 붙었다. 여기서 함께 싣는다.
  // prefs.minutesView 를 먼저 await 해 조건부로 부르면 안 된다 — 직렬 2단이 되고,
  // 아래 히어로 KPI(minutes.length)와 리스트/달력 전환용 월 목록까지 늦어진다.
  const [minutes, tree, m, user, prefs, projects, locale] = await Promise.all([
    getMinutesPage(rs, re, null),
    getMinutesTree(),
    getMembership(),
    getSession(),
    getUiPrefs(),
    listProjects(),
    getServerLocale(),
  ])
  // 기본값은 트리, 미지 값(구버전 롤백·스큐)도 트리로 클램프 — calendar/list만 저장값 유지
  const savedView = prefs.minutesView
  const initialView = savedView === 'calendar' || savedView === 'list' ? savedView : 'tree'
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
      {/* 세션이 없으면 프리페치를 버린다. minutes 의 RLS 는 `to authenticated`(0021:77)라
          세션 없는 RSC 조회는 에러가 아니라 200+빈 배열로 돌아오고, getMinutesTree 는 그걸
          null 이 아닌 빈 트리 객체로 반환한다(minutes.ts:90 주석의 "실패=null/빈결과=객체" 구분).
          그대로 넘기면 '회의록 없음' EmptyState 로 위장되고 클라이언트 self-heal 도 막힌다.
          fetchMinutesTree(actions/minutes.ts:332)가 가진 세션 게이트를 서버 경로에도 맞춘 것.
          user 는 위 Promise.all 에서 이미 받았으므로 추가 왕복은 없다.
          (대가: GoTrue 일시 실패 시 멀쩡한 프리페치를 버려 왕복 1회 손해 — 정확성 우선.) */}
      <MinutesView initialMinutes={minutes} initialTree={user ? tree : null} todayIso={today}
        initialView={initialView} projects={projects} defaultTeam={m?.teamCode ?? null}
        currentUserId={user?.id ?? null} role={m?.role ?? null} />
    </ProjectPageShell>
  )
}
