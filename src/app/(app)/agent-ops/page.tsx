import { createServerClient } from '@/lib/supabase/server'
import { AgentOpsView } from '@/components/agent/AgentOpsView'

export const dynamic = 'force-dynamic'

/**
 * 승인 대기함(2026-08-24 — 옛 "에이전트 관제"). 프로젝트 사이드바에서 `?project=<id>` 로 진입한다.
 * 데이터는 클라이언트에서 fetchAgentOps 액션으로 읽는다(RLS 조회 정책이 2차 방어선).
 */
export default async function AgentOpsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams
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
