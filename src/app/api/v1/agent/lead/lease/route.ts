import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { parseLeaseBody } from '@/lib/agent/leadLease'

/**
 * 팀장 lease — 신원+프로젝트당 /dflow-team 팀장 하나. 스펙 2026-09-23-dflow-lead-lease-design.md §5.
 * 판정·CAS 는 DB 함수(0101)가 행 잠금 안에서 한다. 여기서는 신원·스코프·멤버십만 거른다.
 * PAT 전용 — 레거시 시크릿은 신원이 없어 lease 의 주인을 정할 수 없다.
 */
export const dynamic = 'force-dynamic'

interface AcquireRow { project_id: string; ok: boolean; generation: number; host: string | null; agent: string | null; expires_at: string | null }
interface RenewRow { project_id: string; ok: boolean; expires_at: string | null }

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const parsed = parseLeaseBody(raw)
  if ('error' in parsed) return apiBadRequest(parsed.error)

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    const pids = parsed.op === 'acquire' ? parsed.projects : parsed.leases.map(l => l.project_id)
    if (pids.some(pid => !patProjectAllowed(principal, pid))) {
      return apiFail(403, 'forbidden_role', 'PAT 가 한정된 프로젝트와 다릅니다.')
    }

    if (parsed.op === 'acquire') {
      // 멤버가 아닌 프로젝트의 lease 를 잡아 그 프로젝트의 진짜 팀장을 막는 일을 막는다. 조회 실패도 거절(fail-closed).
      for (const pid of parsed.projects) {
        if (!(await isAgentProjectMember(admin, principal.userId, pid))) {
          return apiFail(403, 'forbidden_role', '이 프로젝트의 멤버가 아닙니다.')
        }
      }
      const { data, error } = await admin.rpc('lead_lease_acquire', {
        p_user: principal.userId, p_projects: parsed.projects, p_holder: parsed.holder,
        p_host: parsed.host, p_agent: parsed.agent, p_takeover: parsed.takeover,
      })
      if (error) { console.error('[agent-api] lease acquire 실패:', error.message); return apiInternalError() }
      const rows = (data ?? []) as AcquireRow[]
      const held = rows.filter(r => !r.ok)
      if (held.length > 0) {
        return NextResponse.json({
          error: '같은 신원의 다른 팀장이 이 프로젝트의 lease 를 쥐고 있습니다.', code: 'lead_lease_held',
          held: held.map(r => ({ project_id: r.project_id, host: r.host, agent: r.agent, expires_at: r.expires_at })),
        }, { status: 409 })
      }
      return NextResponse.json({
        ok: true, leases: rows.map(r => ({ project_id: r.project_id, generation: r.generation, expires_at: r.expires_at })),
      })
    }

    if (parsed.op === 'renew') {
      const { data, error } = await admin.rpc('lead_lease_renew', {
        p_user: principal.userId, p_holder: parsed.holder, p_leases: parsed.leases,
      })
      if (error) { console.error('[agent-api] lease renew 실패:', error.message); return apiInternalError() }
      const rows = (data ?? []) as RenewRow[]
      const kept = rows.filter(r => r.ok && r.expires_at).map(r => r.expires_at as string).sort()
      return NextResponse.json({ ok: true, expires_at: kept[0] ?? null, lost: rows.filter(r => !r.ok).map(r => r.project_id) })
    }

    const { data, error } = await admin.rpc('lead_lease_release', {
      p_user: principal.userId, p_holder: parsed.holder, p_leases: parsed.leases,
    })
    if (error) { console.error('[agent-api] lease release 실패:', error.message); return apiInternalError() }
    return NextResponse.json({ ok: true, released: typeof data === 'number' ? data : 0 })
  } catch (e) {
    console.error('[agent-api] lease 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
