import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireAgentProject, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'

/**
 * GET /api/v1/wbs/structure?project_id=&max_depth= — 프로젝트 levels 정본 + 얕은 노드 조회.
 * PL 스킬(dflow-wbs-nlevel)의 서버 직조회 원천 — 시스템 키·attach 부착점을 이름으로 고르게
 * 한다(스펙 §import 계약 v2.2). 읽기 전용이라 멤버면 통과(비멤버 404 존재 은닉).
 * max_depth 는 0-base 트리 깊이 상한(기본 1 = Phase·System 두 층).
 */
export const dynamic = 'force-dynamic'

const MAX_DEPTH_CAP = 9 // levels 상한(10층)의 0-base 최심

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id') ?? ''
  if (!projectId || !isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  const rawDepth = req.nextUrl.searchParams.get('max_depth')
  const maxDepth = rawDepth === null ? 1 : Number.parseInt(rawDepth, 10)
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH_CAP) {
    return apiBadRequest(`max_depth 는 0~${MAX_DEPTH_CAP} 정수여야 합니다.`)
  }
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'pat') {
      const scopeErr = requireScope(principal, 'work:read')
      if (scopeErr) return scopeErr
      if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    }
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()
    if (principal.kind === 'pat' && !(await isAgentProjectMember(admin, principal.userId, projectId))) {
      return apiNotFound() // 비멤버 404 — 존재 은닉 관례(§2.2)
    }

    // levels 정본 — 행 없음은 미설정 신호로 그대로 노출(기본값 위장 금지 — 3원칙).
    const { data: ps, error: psErr } = await admin
      .from('project_settings').select('level_labels, max_depth')
      .eq('project_id', projectId).maybeSingle()
    if (psErr) {
      console.error('[wbs-structure] 설정 조회 실패:', psErr.message)
      return apiInternalError()
    }
    const settings = ps as { level_labels: string[]; max_depth: number | null } | null

    const { data: rows, error: rowsErr } = await admin
      .from('wbs_items')
      .select('id, parent_id, name, external_ref, level_idx, sort_order')
      .eq('project_id', projectId)
    if (rowsErr) {
      console.error('[wbs-structure] WBS 조회 실패:', rowsErr.message)
      return apiInternalError()
    }
    type Row = { id: string; parent_id: string | null; name: string; external_ref: string | null; level_idx: number | null; sort_order: number }
    const all = (rows ?? []) as Row[]
    const byId = new Map(all.map(r => [r.id, r]))
    // 깊이 계산 — 고아는 루트 취급, 순환은 방문 표시로 끊는다(domain/levelSettings.treeMaxDepth 와 동일 규칙).
    const depthOf = new Map<string, number>()
    const resolve = (id: string): number => {
      const known = depthOf.get(id)
      if (known !== undefined) return known
      depthOf.set(id, 0)
      const p = byId.get(id)?.parent_id
      const d = p != null && byId.has(p) ? resolve(p) + 1 : 0
      depthOf.set(id, d)
      return d
    }
    const nodes = all
      .map(r => ({ row: r, depth: resolve(r.id) }))
      .filter(n => n.depth <= maxDepth)
      .sort((a, b) => a.depth - b.depth || a.row.sort_order - b.row.sort_order)
      .map(({ row, depth }) => ({
        id: row.id,
        external_ref: row.external_ref,
        name: row.name,
        parent_external_ref: row.parent_id ? byId.get(row.parent_id)?.external_ref ?? null : null,
        depth,
        level_idx: row.level_idx,
      }))

    return NextResponse.json({
      ok: true,
      levels: settings?.level_labels ?? null,
      max_depth: settings?.max_depth ?? null,
      nodes,
    })
  } catch (e) {
    console.error('[wbs-structure] 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
