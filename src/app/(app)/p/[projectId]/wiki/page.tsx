import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getActorViewState } from '@/lib/authz'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WikiSearch } from '@/components/wiki/WikiSearch'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/**
 * ?q= — 검색어를 URL 에 남기는 이유는 둘이다. 문서를 열었다 뒤로 오면 검색어가
 * 사라져 매번 다시 치던 문제, 그리고 찾은 결과를 링크로 넘길 수 없던 문제.
 * 200자를 넘는 값은 검색어가 아니라고 보고 버린다.
 */
function parseQuery(value: string | string[] | undefined): string {
  return typeof value === 'string' && value.length <= 200 ? value : ''
}

export default async function ProjectWikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const { projectId } = await params
  const { q } = await searchParams
  const [locale, { actor, degraded }] = await Promise.all([
    getServerLocale(),
    getActorViewState(),
  ])

  // 접근 제어는 검색 API가 처리하지만, 프로젝트 존재 확인은 여기서 한다.
  // 비공개 프로젝트도 목록에 나타나지 않는다면 notFound() 하지만,
  // 조회 자체가 실패했다면 degraded 를 보여준다.
  if (!actor?.userId) notFound()

  const client = await createServerClient()
  const scope = await createSupabaseAccessScopeResolver(client).resolve(actor.userId)

  if (!scope.ok) {
    // 조회 실패 - 에러 페이지가 맞다
    throw new Error(`Failed to check project access: ${scope.code}`)
  }

  // 프로젝트 목록에 없으면 접근 불가
  if (!scope.scope.allowedProjectIds.includes(projectId)) {
    notFound()
  }

  const projectName = projectId // 프로젝트명은 별도 fetch 대신 ID 표시
  const initialQuery = parseQuery(q)

  return (
    <ProjectPageShell
      hero={<PageHero title={`${projectName}${t(locale, 'wiki.heroTitleSuffix')}`} />}
    >
      <WikiSearch projectId={projectId} locale={locale} initialQuery={initialQuery} />
    </ProjectPageShell>
  )
}
