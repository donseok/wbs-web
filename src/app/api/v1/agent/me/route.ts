import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import {
  AGENT_CONTRACT_VERSION, apiFail, apiInternalError,
  patProjectAllowed, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/me — whoami. 404 존재 은닉 아래의 유일한 진단 창구(계약 v2.0). PAT 전용. */
export const dynamic = 'force-dynamic'

/** 프로젝트별 사용자 역할 조회 — superuser/admin/member. fail-closed = null. */
async function memberRole(admin: AdminClient, userId: string, projectId: string): Promise<string | null> {
  const { data: mem } = await admin.from('memberships').select('is_superuser').eq('user_id', userId).maybeSingle()
  if ((mem as { is_superuser?: boolean } | null)?.is_superuser) return 'superuser'
  const { data: roles, error } = await admin
    .from('project_roles').select('role').eq('user_id', userId).eq('project_id', projectId).limit(1)
  if (error || !roles || roles.length === 0) return null // fail-closed
  return (roles[0] as { role: string }).role
}

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') {
      return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    }

    const { data: regs, error: regErr } = await admin
      .from('agent_projects').select('project_id').eq('enabled', true)
    if (regErr) {
      console.error('[agent-api] enabled 프로젝트 조회 실패:', regErr.message)
      return apiInternalError()
    }
    const candidateIds = ((regs ?? []) as Array<{ project_id: string }>)
      .map(r => r.project_id)
      .filter(pid => patProjectAllowed(principal, pid))

    const nameById = new Map<string, string>()
    if (candidateIds.length > 0) {
      const { data: projs, error: projErr } = await admin
        .from('projects').select('id, name').in('id', candidateIds)
      if (projErr) {
        console.error('[agent-api] 프로젝트 이름 조회 실패:', projErr.message)
        return apiInternalError()
      }
      for (const p of (projs ?? []) as Array<{ id: string; name: string }>) nameById.set(p.id, p.name)
    }

    const projects: Array<{ id: string; name: string; role: string }> = []
    for (const pid of candidateIds) {
      // 프로젝트별 멤버십 판정 — enabled 프로젝트 수는 소수라 순회 비용 무시 가능.
      const role = await memberRole(admin, principal.userId, pid)
      if (role) {
        projects.push({ id: pid, name: nameById.get(pid) ?? '', role })
      }
    }
    return NextResponse.json({
      ok: true, user_email: principal.userEmail, scopes: principal.scopes,
      kind: principal.runnerKind, token_expires_at: principal.tokenExpiresAt,
      contract_version: AGENT_CONTRACT_VERSION, projects,
    })
  } catch (e) {
    console.error('[agent-api] me 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = POST
export const DELETE = POST
export const PATCH = POST
export const OPTIONS = POST
