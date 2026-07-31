import { createServerClient } from '@/lib/supabase/server'
import { AgentOpsView } from '@/components/agent/AgentOpsView'

export const dynamic = 'force-dynamic'

/**
 * 에이전트 관제 — 스펙 §5. 사이드바 미노출(1차 범위 제외), URL 직접 접근.
 * 데이터는 클라이언트에서 fetchAgentOps 액션으로 읽는다(RLS 조회 정책이 2차 방어선).
 */
export default async function AgentOpsPage() {
  const sb = await createServerClient()
  // 조회 실패는 빈 목록으로 위장하지 않는다 — 에러 문자열을 뷰에 넘겨 표시한다.
  const { data: projects, error } = await sb.from('projects').select('id, name').order('name')
  return (
    <AgentOpsView
      projects={(projects ?? []) as { id: string; name: string }[]}
      loadError={error ? error.message : null}
    />
  )
}
