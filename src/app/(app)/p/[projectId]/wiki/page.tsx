import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getActorViewState } from '@/lib/authz'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WikiSearch } from '@/components/wiki/WikiSearch'
import { WikiReindexButton } from '@/components/wiki/WikiReindexButton'
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

  // 권한 조회 실패를 "없는 페이지" 로 위장하지 않는다 — 장애와 접근 불가는 다르다.
  if (degraded) throw new Error('ACTOR_LOOKUP_FAILED')
  if (!actor?.userId) notFound()

  const client = await createServerClient()
  // 히어로 제목에 쓸 이름 하나 때문에 전체 프로젝트 목록(listProjects)을 읽지 않는다 —
  // 이름 단건 조회는 접근 범위 판정과 독립이라 같은 왕복에 병렬로 태운다.
  const [scope, projectRow] = await Promise.all([
    createSupabaseAccessScopeResolver(client).resolve(actor.userId),
    client.from('projects').select('name').eq('id', projectId).maybeSingle(),
  ])

  if (!scope.ok) {
    // 조회 실패 - 에러 페이지가 맞다
    throw new Error(`Failed to check project access: ${scope.code}`)
  }

  // 프로젝트 목록에 없으면 접근 불가
  if (!scope.scope.allowedProjectIds.includes(projectId)) {
    notFound()
  }

  // 이름 조회 실패는 접근 판정과 무관한 표시용 결손이라 폴백 이름으로 렌더하되,
  // "데이터 없음"으로 위장하지 않도록 로그는 남긴다.
  if (projectRow.error) {
    console.error('[ProjectWikiPage] 프로젝트 이름 조회 실패:', projectRow.error.message)
  }
  const projectName = projectRow.data?.name ?? t(locale, 'wiki.projectFallback')
  const initialQuery = parseQuery(q)
  // 색인 수동 갱신은 슈퍼유저 전용 — 일반 사용자에겐 스트립 자체를 렌더하지 않는다.
  // 히어로 카드 우상단의 빈 다크 영역에 앉히려고 슬롯으로 내려보낸다(카드 밖 별도 줄 아님).
  const isSuperuser = actor.isSuperuser === true

  return (
    <ProjectPageShell
      hero={<PageHero title={`${projectName}${t(locale, 'wiki.heroTitleSuffix')}`} />}
    >
      <WikiSearch
        projectId={projectId}
        locale={locale}
        initialQuery={initialQuery}
        adminSlot={isSuperuser ? <WikiReindexButton locale={locale} /> : undefined}
      />
    </ProjectPageShell>
  )
}
