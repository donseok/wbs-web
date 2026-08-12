import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound,
  requireAgentProject, requireScope, resolveAgentPrincipal, patProjectAllowed,
} from '@/lib/agent/externalApi'
import { isUuidLike } from '@/lib/domain/agentWork'
import { applyAssigneesAndOrders, toRpcNode, type ImportNode } from '@/lib/agent/wbsImport'
import { emitNotification } from '@/lib/notify/emit'

/** POST /api/v1/wbs/import — export JSON 모듈별 upsert 업로드(§2.6). PAT 전용·관리자 전용. */
export const dynamic = 'force-dynamic'

const MAX_NODES = 1000

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = raw as Record<string, unknown>
  const projectId = typeof b.project_id === 'string' ? b.project_id : ''
  const module_ = typeof b.module === 'string' ? b.module.trim() : ''
  if (!isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(module_)) return apiBadRequest('module 형식이 올바르지 않습니다.')
  if (!Array.isArray(b.nodes) || b.nodes.length === 0) return apiBadRequest('nodes가 필요합니다.')
  if (b.nodes.length > MAX_NODES) return apiBadRequest(`nodes는 ${MAX_NODES}건 이하여야 합니다.`)

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:report')
    if (scopeErr) return scopeErr
    if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()
    // import = 구조 쓰기 + 자동 발행 트리거 — 발행과 같은 관리자 전용(§2.8). member 는 403.
    const { data: roleRow, error: roleErr } = await admin
      .from('project_roles').select('role').eq('user_id', principal.userId).eq('project_id', projectId).limit(1)
    const { data: mem, error: memErr } = await admin
      .from('memberships').select('is_superuser').eq('user_id', principal.userId).maybeSingle()
    if (roleErr || memErr) return apiInternalError()
    const isSuper = !!(mem as { is_superuser?: boolean } | null)?.is_superuser
    const isAdmin = ((roleRow ?? []) as Array<{ role: string }>).some(r => r.role === 'admin')
    if (!isSuper && !isAdmin) return apiFail(403, 'forbidden_role', '프로젝트 관리자만 업로드할 수 있습니다.')

    // 변환 — 실패 노드는 생략하지 않고 400 으로 전량 보고(에러 3원칙).
    const rpcNodes: unknown[] = []
    const assigneeByRef: Record<string, string | null> = {}
    const titleByRef: Record<string, string> = {}
    const errors: string[] = []
    for (const [i, nRaw] of (b.nodes as ImportNode[]).entries()) {
      const r = toRpcNode(module_, nRaw, i)
      if ('error' in r) { errors.push(r.error); continue }
      rpcNodes.push(r)
      assigneeByRef[r.external_ref] = r.assignee
      titleByRef[r.external_ref] = r.title
    }
    if (errors.length > 0) return apiBadRequest(`노드 변환 실패 ${errors.length}건: ${errors.slice(0, 5).join(' / ')}`)

    const { data: rpcOut, error: rpcErr } = await admin
      .rpc('import_wbs_upsert', { p_project_id: projectId, p_nodes: rpcNodes })
    if (rpcErr) {
      console.error('[wbs-import] upsert 실패:', rpcErr.message)
      return apiFail(409, 'apply_failed', `업로드 실패: ${rpcErr.message}`)
    }
    const out = rpcOut as { upserted: number; skipped: number; ids: Record<string, string>; new_refs: string[] }

    const post = await applyAssigneesAndOrders(admin, {
      projectId, actorUserId: principal.userId,
      newRefs: out.new_refs, idsByRef: out.ids, assigneeByRef, titleByRef,
    })

    // 실행자에게 업로드 결과 통지 — 응답 확정 후 실행(after), 본 응답을 막지 않음.
    if (principal.userId) {
      const notifyUserId = principal.userId
      after(() => emitNotification({
        type: 'system.import_result',
        projectId,
        entityType: 'wbs_import',
        payload: {
          title: 'WBS 업로드',
          detail: `upserted ${out.upserted}건, 담당자 미매칭 ${post.unmatched.length}건`,
          href: `/p/${projectId}/wbs`,
        },
        recipientUserIds: [notifyUserId],
      }).catch(() => {
        // 알림 실패는 로깅만 하고 본 응답에 영향을 주지 않음(emitNotification 내부에서 로깅)
      }))
    }

    return NextResponse.json({
      ok: true, upserted: out.upserted, skipped: out.skipped,
      unmatched_assignees: post.unmatched, non_leaf_skipped: post.nonLeafSkipped,
      orders_created: post.ordersCreated,
    })
  } catch (e) {
    console.error('[wbs-import] 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = GET
export const DELETE = GET
export const PATCH = GET
export const OPTIONS = GET
