import type { AdminClient } from '@/lib/minutes/externalApi'
import { isAgentProjectMember, patProjectAllowed, type AgentPrincipal } from '@/lib/agent/externalApi'

/**
 * PAT 가 접근 가능한 프로젝트 ID 목록 — enabled agent_projects ∩ 멤버 프로젝트.
 * Task 7: GET /work/mine · Task 10·15: /work/mine (claimed/all/assigned 스코프 확장용)
 */
export async function accessibleProjectIds(
  admin: AdminClient,
  principal: Extract<AgentPrincipal, { kind: 'pat' }>,
): Promise<string[]> {
  const { data: regs, error } = await admin.from('agent_projects').select('project_id').eq('enabled', true)
  if (error) throw new Error(`enabled 프로젝트 조회 실패: ${error.message}`)
  const out: string[] = []
  for (const r of (regs ?? []) as Array<{ project_id: string }>) {
    if (!patProjectAllowed(principal, r.project_id)) continue
    if (await isAgentProjectMember(admin, principal.userId, r.project_id)) out.push(r.project_id)
  }
  return out
}
