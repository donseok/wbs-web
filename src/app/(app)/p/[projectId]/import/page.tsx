import { Shield } from 'lucide-react'
import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { ImportWizard } from '@/components/import/ImportWizard'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/** replace 경고 문구에 실제 삭제 건수를 싣기 위한 조회(리뷰 Important #1). 조회 실패는
 *  표시=로깅 원칙대로 로그만 남기고 null 로 degrade — 마법사는 숫자 없는 문구로 계속 동작한다. */
async function fetchWbsItemCount(projectId: string): Promise<number | null> {
  const sb = await createServerClient()
  const { count, error } = await sb
    .from('wbs_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (error) {
    console.error('[import] wbs_items 건수 조회 실패 — 경고 문구는 건수 없이 표시:', error.message)
    return null
  }
  return count ?? null
}

/**
 * 임포트 마법사 진입 페이지(§6.2) — 서버는 프로젝트 실재·권한 확인만 하고, 감지·실행은 전부
 * 클라이언트가 `/api/import/inspect`·`/api/import/execute` 를 직접 호출한다(서버 임시 저장 없음).
 */
export default async function ImportWizardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [projects, actor, locale] = await Promise.all([listProjects(), getActorForView(), getServerLocale()])
  const project = projects.find(p => p.id === projectId)
  const isAdmin = isProjectAdmin(actor, projectId)
  const isSuperuser = actor?.isSuperuser === true
  const projectName = project?.name ?? t(locale, 'importWizard.projectFallback')
  // 비관리자는 위저드를 렌더하지 않으니(아래) 조회 자체를 건너뛴다 — 불필요한 쿼리 방지.
  const currentItemCount = isAdmin ? await fetchWbsItemCount(projectId) : null

  return (
    <ProjectPageShell
      hero={
        <PageHero
          eyebrow="IMPORT"
          badge={<HeroBadge>{t(locale, 'importWizard.badge')}</HeroBadge>}
          title={`${projectName} ${t(locale, 'importWizard.heroTitleSuffix')}`}
          description={t(locale, 'importWizard.heroDesc')}
        />
      }
    >
      {isAdmin ? (
        <ImportWizard projectId={projectId} isSuperuser={isSuperuser} currentItemCount={currentItemCount} />
      ) : (
        <EmptyState
          icon={Shield}
          title={t(locale, 'importWizard.noPermissionTitle')}
          description={t(locale, 'importWizard.noPermissionDesc')}
        />
      )}
    </ProjectPageShell>
  )
}
