import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { createServerClient } from '@/lib/supabase/server'
import { AgentOpsView } from '@/components/agent/AgentOpsView'

export const dynamic = 'force-dynamic'

/**
 * 승인 대기함(2026-08-24 — 옛 "에이전트 관제"). 슈퍼유저 전용 — 사이드바·모바일 메뉴 링크와 같은 판정이라
 * 링크만 보이고 페이지는 거부되는 드리프트가 없다. `?project=<id>` 로 초기 프로젝트를 고를 수 있다.
 * 데이터는 클라이언트에서 fetchAgentOps 액션으로 읽는다(RLS 조회 정책이 2차 방어선).
 */
export default async function AgentOpsPage({ searchParams }: { searchParams?: Promise<{ project?: string }> } = {}) {
  // fail-closed — actor 를 모르면(비로그인·degraded) 슈퍼유저라고 주장하지 않는다.
  const actor = await getActorForView()
  if (!actor?.isSuperuser) redirect('/projects')

  const { project } = (await searchParams) ?? {}
  const sb = await createServerClient()
  // 조회 실패는 빈 목록으로 위장하지 않는다 — 에러 문자열을 뷰에 넘겨 표시한다.
  const { data: projects, error } = await sb.from('projects').select('id, name').order('name')
  return (
    <AgentOpsView
      projects={(projects ?? []) as { id: string; name: string }[]}
      loadError={error ? error.message : null}
      initialProjectId={project}
    />
  )
}
