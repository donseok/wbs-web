import { NextResponse } from 'next/server'
import { resolveUserByEmail, type AdminClient } from '@/lib/minutes/externalApi'
import { AGENT_NAME_RE } from '@/lib/domain/agentWork'
import {
  apiFail, apiInternalError, apiNotFound, isAgentProjectMember, requireAgentProject,
} from '@/lib/agent/externalApi'

/**
 * 쓰기 라우트(claim/release/report) 공통 선행부.
 * route.ts 안에 두지 않는 이유: App Router 는 라우트 파일에서 HTTP 메서드 외 export 를
 * 빌드에서 거부한다 — 공용 로직은 lib 로 빼는 것이 유일한 합법 경로다.
 */
export function parseAgentActor(raw: unknown): { userEmail: string; agent: string } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: '잘못된 요청입니다.' }
  const b = raw as Record<string, unknown>
  const userEmail = typeof b.user_email === 'string' ? b.user_email.trim() : ''
  if (!userEmail) return { error: 'user_email이 필요합니다.' }
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!AGENT_NAME_RE.test(agent)) return { error: 'agent 이름 형식이 올바르지 않습니다(영숫자·._- 64자).' }
  return { userEmail, agent }
}

/** 주문 로드 + 프로젝트 게이트 + 멤버 판정. 실패는 완성된 NextResponse 로 돌려준다. */
export async function loadGatedOrder(admin: AdminClient, id: string, userEmail: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; claimed_by: string | null; wbs_item_id: string | null }; userId: string }
  | { ok: false; res: NextResponse }
> {
  const { data: order, error } = await admin
    .from('agent_work_orders')
    .select('id, project_id, status, claimed_by, wbs_item_id')
    .eq('id', id).maybeSingle()
  if (error) {
    console.error('[agent-api] 주문 조회 실패:', error.message)
    return { ok: false, res: apiInternalError() }
  }
  if (!order) return { ok: false, res: apiNotFound() }
  const row = order as { id: string; project_id: string; status: string; claimed_by: string | null; wbs_item_id: string | null }
  if (!(await requireAgentProject(admin, row.project_id))) return { ok: false, res: apiNotFound() }
  const user = await resolveUserByEmail(admin, userEmail)
  if (!user) return { ok: false, res: apiFail(403, 'unknown_user', "해당 이메일의 D'Flow 사용자가 없습니다.") }
  if (!(await isAgentProjectMember(admin, user.id, row.project_id))) {
    return { ok: false, res: apiFail(403, 'forbidden_role', '그 프로젝트의 멤버 이상만 실행할 수 있습니다.') }
  }
  return { ok: true, order: row, userId: user.id }
}
