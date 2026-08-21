import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound,
  isAgentProjectAdmin, isAgentProjectMember, requireAgentProject, requireScope, resolveAgentPrincipal, patProjectAllowed,
} from '@/lib/agent/externalApi'
import { isUuidLike } from '@/lib/domain/agentWork'
import { applyAssigneesAndOrders, toRpcNode, validateLevels, type ImportNode, type LevelDecl } from '@/lib/agent/wbsImport'
import { treeMaxDepth, validateLevelSettings } from '@/lib/domain/levelSettings'
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

  // v2.2(nlevel) — 구조 검증은 인증 전(순수), DB 대조는 인증 후. 스펙 §import 계약 v2.2.
  const attachRef = typeof b.attach_ref === 'string' ? b.attach_ref.trim() : ''
  let levels: LevelDecl[] | null = null
  if (b.levels !== undefined) {
    const v = validateLevels(b.levels)
    if ('error' in v) return apiBadRequest(`levels 검증 실패: ${v.error}`)
    levels = v.levels
  }
  if (attachRef && !levels) return apiBadRequest('attach_ref 업로드(PL)는 levels 가 필수입니다.')

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:report')
    if (scopeErr) return scopeErr
    if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()
    // 비멤버는 404(존재 은닉, 계약 §인증 — "PAT principal 은 멤버십 없으면 404"). 관리자 판정보다 먼저 —
    // 아니면 완전 비멤버가 관리자 판정에서 403 forbidden_role 을 받아 "프로젝트가 존재한다"가 샌다.
    if (!(await isAgentProjectMember(admin, principal.userId, projectId))) return apiNotFound()
    // import = 구조 쓰기 + 자동 발행 트리거 — 발행과 같은 관리자 전용(§2.8). member 는 403.
    // 판정은 isAgentProjectAdmin 한 곳 — 조회 실패는 헬퍼가 throw 해 아래 catch 가 500 으로 답한다.
    if (!(await isAgentProjectAdmin(admin, principal.userId, projectId))) {
      return apiFail(403, 'forbidden_role', '프로젝트 관리자만 업로드할 수 있습니다.')
    }

    // v2.2 — levels·attach 의 DB 대조 (인증 뒤·변환 앞).
    let attachId: string | null = null
    if (levels && attachRef) {
      // PL 업로드: levels 는 서버 정본(level_labels)과 완전 일치해야 통과(불일치 = 파일이 낡음).
      const { data: ps, error: psErr } = await admin
        .from('project_settings').select('level_labels').eq('project_id', projectId).maybeSingle()
      if (psErr) throw new Error(`프로젝트 설정 조회 실패: ${psErr.message}`)
      const serverLabels = (ps as { level_labels: string[] } | null)?.level_labels ?? null
      const payloadLabels = levels.map(l => l.name)
      if (!serverLabels || JSON.stringify(serverLabels) !== JSON.stringify(payloadLabels)) {
        return apiFail(400, 'levels_mismatch',
          `levels 가 프로젝트 정본과 다릅니다. 골격의 levels 를 다시 복사하세요. (정본: ${serverLabels?.join('>') ?? '없음'})`)
      }
      // attach 노드 해석(크로스 모듈 external_ref) — 없으면 fail-closed(골격 선행의 기계 검증).
      const { data: attachRow, error: attachErr } = await admin
        .from('wbs_items').select('id').eq('project_id', projectId).eq('external_ref', attachRef).maybeSingle()
      if (attachErr) throw new Error(`attach 노드 조회 실패: ${attachErr.message}`)
      if (!attachRow) return apiFail(400, 'attach_not_found', `attach 노드가 없습니다: ${attachRef} — 골격을 먼저 업로드하세요.`)
      attachId = (attachRow as { id: string }).id
    } else if (levels) {
      // 골격 업로드: level_labels 시드 — 설정 편집과 동일한 검증(축소 fail-closed 포함).
      const { data: rows, error: rowsErr } = await admin
        .from('wbs_items').select('id, parent_id').eq('project_id', projectId)
      if (rowsErr) throw new Error(`WBS 조회 실패: ${rowsErr.message}`)
      const v = validateLevelSettings({
        labels: levels.map(l => l.name),
        currentTreeMaxDepth: treeMaxDepth((rows ?? []) as Array<{ id: string; parent_id: string | null }>),
      })
      if (!v.ok) return apiBadRequest(`levels 시드 실패: ${v.error}`)
      const { error: seedErr } = await admin.from('project_settings').upsert({
        project_id: projectId, level_labels: v.labels, max_depth: v.maxDepth,
        updated_at: new Date().toISOString(), updated_by: principal.userId,
      })
      if (seedErr) throw new Error(`levels 시드 실패: ${seedErr.message}`)
    }

    // 변환 — 실패 노드는 생략하지 않고 400 으로 전량 보고(에러 3원칙).
    const rpcNodes: unknown[] = []
    const assigneeByRef: Record<string, string | null> = {}
    const titleByRef: Record<string, string> = {}
    const kindByRef: Record<string, string> = {}
    const errors: string[] = []
    for (const [i, nRaw] of (b.nodes as ImportNode[]).entries()) {
      const r = toRpcNode(module_, nRaw, i, levels)
      if ('error' in r) { errors.push(r.error); continue }
      rpcNodes.push(r)
      assigneeByRef[r.external_ref] = r.assignee
      titleByRef[r.external_ref] = r.title
      // 주문 보장 대상 판정 — v2.2: dev_workflow 가 정본(levels 있으면 input 층, 없으면 kind==='task' 와 동치).
      kindByRef[r.external_ref] = r.dev_workflow ? 'task' : nRaw.kind ?? 'other'
    }
    if (errors.length > 0) return apiBadRequest(`노드 변환 실패 ${errors.length}건: ${errors.slice(0, 5).join(' / ')}`)

    // p_attach_id 는 attach 경로에서만 싣는다 — 레거시 payload 는 구 2인자 시그니처와도 호환(배포 순서 안전).
    const { data: rpcOut, error: rpcErr } = await admin
      .rpc('import_wbs_upsert', attachId
        ? { p_project_id: projectId, p_nodes: rpcNodes, p_attach_id: attachId }
        : { p_project_id: projectId, p_nodes: rpcNodes })
    if (rpcErr) {
      console.error('[wbs-import] upsert 실패:', rpcErr.message)
      return apiFail(409, 'apply_failed', `업로드 실패: ${rpcErr.message}`)
    }
    const out = rpcOut as { upserted: number; skipped: number; ids: Record<string, string>; new_refs: string[] }

    const post = await applyAssigneesAndOrders(admin, {
      projectId, actorUserId: principal.userId, module: module_,
      newRefs: out.new_refs, idsByRef: out.ids, assigneeByRef, titleByRef, kindByRef,
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
