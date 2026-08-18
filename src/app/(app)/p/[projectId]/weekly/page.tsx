import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import { mondayIso, sheetWeekMeta } from '@/lib/report/week'
import { getWeeklySheet, hasCarryOverSource } from '@/lib/data/weeklySheet'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'
import { seoulToday } from '@/lib/domain/dates'

export default async function WeeklyPage({
  params, searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { projectId } = await params
  const { week } = await searchParams
  const weekStart = mondayIso(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : seoulToday())
  const wk = sheetWeekMeta(weekStart)

  const [sheet, hasCarry, projects, locale, user, actor] = await Promise.all([
    getWeeklySheet(projectId, weekStart),
    // 판정 전용 경량 조회 — 셀 내용(최대 44셀×20,000자)을 실어오지 않는다(2026-08-18 성능 감사).
    hasCarryOverSource(projectId, weekStart),
    listProjects(),
    getServerLocale(),
    getSession(),
    // 어포던스 게이팅용 — 조회 실패는 null(조회 전용)로 열화한다. 쓰기는 서버 액션 가드가 다시 판정.
    getActorForView(),
  ])
  const projectName = projects.find(p => p.id === projectId)?.name ?? ''
  // 프레즌스 신원 — 표시명 규칙은 헤더와 동일(full_name → name → 이메일 아이디)
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null

  return (
    <ProjectPageShell
      // 이 화면은 구글시트 복제 룩이 주인공 — 큰 히어로 대신 콤팩트한 한 줄 헤더만 둔다.
      // 다른 프로젝트 화면(회의 등)과 동일하게 공용 PageHero(다크 히어로 카드)를 사용해 디자인 통일성 유지.
      hero={<PageHero title={`${projectName} ${t(locale, 'nav.weekly')}`} />}
    >
      <WeeklySheetView
        projectId={projectId}
        weekStart={weekStart}
        weekLabel={`${wk.label} (${wk.thisRange})`}
        weekTitle={wk.label}
        thisRange={wk.thisRange}
        nextRange={wk.nextRange}
        projectName={projectName}
        report={sheet ? { id: sheet.report.id, title: sheet.report.title } : null}
        initialRows={sheet?.rows ?? []}
        hasCarrySource={hasCarry}
        me={me}
        canEditCells={isProjectMember(actor, projectId)}
        canCreateRound={isProjectAdmin(actor, projectId)}
      />
    </ProjectPageShell>
  )
}
