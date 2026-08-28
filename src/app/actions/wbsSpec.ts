'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { SPEC_UPDATED_TOKEN } from '@/lib/domain/wbsSpecLog'
import { backfillProjectOrders, ensureAgentProject, ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { setWbsDevWorkflow } from '@/app/actions/wbsAssign'

/**
 * WBS 명세(spec 마크다운·참조 필드) 조회·편집 — 결정 B: 실물 문서는 로컬 git, DB 에는
 * 참조 문자열(prd_ref·entry_point)과 조립된 마크다운 본문(spec)만 둔다. import(0077
 * import_wbs_upsert)가 구조·명세 필드의 정본이고, 이 액션들은 웹에서의 보정 편집 경로다.
 * 편집 권한은 배정(§2.5)과 동일 — 프로젝트 관리자. wbsAssign.ts(Task 12)의
 * loadItem·requireProjectAdmin 패턴을 그대로 따른다(파일 스코프상 import 하지 않고 이 파일에 둔다).
 */

const SPEC_MAX = 1_048_576 // 1MB — spec 은 본문이지 저장소가 아니다(실물 문서는 로컬 git, 결정 A)
const PRIORITY_LABELS = new Set(['critical', 'high', 'medium', 'low'])

export type WbsPriority = 'critical' | 'high' | 'medium' | 'low'

export interface WbsSpecDetail {
  category: string | null
  domain: string | null
  priority: WbsPriority | null
  model: string | null
  tags: string[]
  depends: string[]
  prdRef: string | null
  entryPoint: string | null
  /** 정본은 import(0077) — 이 화면에서는 읽기 전용 체크리스트로만 표시. */
  acceptance: string[]
  spec: string | null
  externalRef: string | null
  /** 에이전트 위임 시 사용자 지시문(0090) — 웹 전용 필드. import 가 덮지 않아 재업로드에도 보존. */
  agentPrompt: string | null
}

/**
 * itemId → project_id 해석 — RLS 스코프(resolveProjectId, 호출자 세션의 일반 클라이언트)로만
 * 조회한다. admin(service_role) 클라이언트로 먼저 존재를 확인하면 RLS 를 우회해 "존재하지만
 * 권한 없음(admin 판정 실패)"과 "존재 자체가 없음"이 서로 다른 에러로 갈라진다 — 비멤버가 임의
 * UUID 로 이 둘을 구분해 다른 프로젝트 항목의 존재를 추정할 수 있다(존재 오라클, 리뷰 라운드 1).
 * resolveProjectId 는 호출자에게 보이지 않는 행을 "대상을 찾을 수 없습니다"로 동일하게 반환해
 * 이 구분을 없앤다.
 */
async function loadItemProject(itemId: string): Promise<
  | { ok: true; projectId: string }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (resolved.projectId === null) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  return { ok: true, projectId: resolved.projectId }
}

/**
 * 선택된 항목의 명세 조회 — RowDetailPanel 선택 변경 시 클라이언트에서 별도 로드
 * (getWbsAssigneeStage 관례와 동일. ComputedItem 을 확장하지 않는다).
 *
 * 실패는 null — 3원칙 ①: "조회 안 됨"을 "명세 없음"으로 위장하면 관리자가 실제 값을
 * 못 본 채 편집 폼을 열어 조용히 덮어쓸 수 있다. 패널은 null 을 "표시 불가"로 렌더한다.
 */
export async function getWbsSpec(itemId: string): Promise<WbsSpecDetail | null> {
  if (!isUuidLike(itemId)) return null
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) {
    console.error('[getWbsSpec] 프로젝트 조회 실패:', resolved.error)
    return null
  }
  const g = await requireProjectMember(resolved.projectId)
  if (!g.ok) {
    console.error('[getWbsSpec] 권한 없음:', g.error)
    return null
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('wbs_items')
    .select('category, domain, priority, model, tags, depends, prd_ref, entry_point, acceptance, spec, external_ref, agent_prompt')
    .eq('id', itemId).maybeSingle()
  if (error) {
    console.error('[getWbsSpec] 조회 실패:', error.message)
    return null
  }
  if (!data) return null
  const row = data as {
    category: string | null
    domain: string | null
    priority: string | null
    model: string | null
    tags: string[] | null
    depends: string[] | null
    prd_ref: string | null
    entry_point: string | null
    acceptance: unknown
    spec: string | null
    external_ref: string | null
    agent_prompt: string | null
  }
  return {
    category: row.category ?? null,
    domain: row.domain ?? null,
    priority: (row.priority as WbsPriority | null) ?? null,
    model: row.model ?? null,
    tags: row.tags ?? [],
    depends: row.depends ?? [],
    prdRef: row.prd_ref ?? null,
    entryPoint: row.entry_point ?? null,
    acceptance: Array.isArray(row.acceptance) ? row.acceptance.filter((v): v is string => typeof v === 'string') : [],
    spec: row.spec ?? null,
    externalRef: row.external_ref ?? null,
    agentPrompt: row.agent_prompt ?? null,
  }
}

export interface SpecLinkItem {
  /** external_ref 원문(<module>/<id>). 해석 실패해도 이 값은 남는다. */
  ref: string
  /** wbs_items.id(uuid). 화면 이동 콜백이 쓰는 키. 해석 실패 시 null. */
  itemId: string | null
  code: string | null
  name: string | null
  stage: string | null
  actualPct: number | null
}

export interface WbsSpecLinks {
  /** depends 를 해석한 선행 항목. depends 배열 순서를 유지하고, 못 찾은 ref 도 자리를 남긴다. */
  predecessors: SpecLinkItem[]
  /** 이 항목의 external_ref 를 depends 에 담은 작업들(code 오름차순). */
  successors: SpecLinkItem[]
}

type LinkRow = {
  id: string
  code: string | null
  name: string | null
  stage: string | null
  actual_pct: number | null
  external_ref: string | null
}

function toLinkItem(ref: string, row: LinkRow | undefined): SpecLinkItem {
  if (!row) return { ref, itemId: null, code: null, name: null, stage: null, actualPct: null }
  return {
    ref,
    itemId: row.id,
    code: row.code ?? null,
    name: row.name ?? null,
    stage: row.stage ?? null,
    actualPct: row.actual_pct === null || row.actual_pct === undefined ? null : Number(row.actual_pct),
  }
}

const LINK_COLUMNS = 'id, code, name, stage, actual_pct, external_ref'

/**
 * 명세 선행(depends)·후행(역참조) 항목 조회 — 명세 본문과 별도 조회다.
 * depends 는 external_ref 문자열이라 화면이 클릭 이동(= wbs_items.id)에 쓰려면 해석이 필요하다.
 *
 * 실패는 null — getWbsSpec 과 같은 3원칙 ①. "조회 실패"를 빈 배열로 돌려주면
 * 화면이 "선행 없음 → 지금 시작해도 됨"으로 조용히 뒤집힌다. 정상 0건만 빈 배열이다.
 */
export async function getWbsSpecLinks(itemId: string): Promise<WbsSpecLinks | null> {
  if (!isUuidLike(itemId)) return null
  const resolved = await resolveProjectId('wbs_items', itemId)
  if (!resolved.ok) {
    console.error('[getWbsSpecLinks] 프로젝트 조회 실패:', resolved.error)
    return null
  }
  const g = await requireProjectMember(resolved.projectId)
  if (!g.ok) {
    console.error('[getWbsSpecLinks] 권한 없음:', g.error)
    return null
  }
  const sb = await createServerClient()
  const { data: selfRow, error: selfErr } = await sb
    .from('wbs_items').select('depends, external_ref').eq('id', itemId).maybeSingle()
  if (selfErr) {
    console.error('[getWbsSpecLinks] 항목 조회 실패:', selfErr.message)
    return null
  }
  if (!selfRow) return null
  const self = selfRow as { depends: string[] | null; external_ref: string | null }
  const depends = self.depends ?? []
  const externalRef = self.external_ref

  const [predecessorResult, successorResult] = await Promise.all([
    depends.length
      ? sb.from('wbs_items').select(LINK_COLUMNS).eq('project_id', resolved.projectId).in('external_ref', depends)
      : Promise.resolve({ data: [] as LinkRow[], error: null }),
    externalRef
      ? sb.from('wbs_items').select(LINK_COLUMNS).eq('project_id', resolved.projectId).contains('depends', [externalRef])
      : Promise.resolve({ data: [] as LinkRow[], error: null }),
  ])
  if (predecessorResult.error) {
    console.error('[getWbsSpecLinks] 선행 조회 실패:', predecessorResult.error.message)
    return null
  }
  if (successorResult.error) {
    console.error('[getWbsSpecLinks] 후행 조회 실패:', successorResult.error.message)
    return null
  }

  const byRef = new Map<string, LinkRow>()
  ;((predecessorResult.data ?? []) as LinkRow[]).forEach(row => {
    if (row.external_ref) byRef.set(row.external_ref, row)
  })
  const predecessors = depends.map(ref => toLinkItem(ref, byRef.get(ref)))
  const successors = ((successorResult.data ?? []) as LinkRow[])
    .map(row => toLinkItem(row.external_ref ?? row.id, row))
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))

  return { predecessors, successors }
}

export async function updateWbsSpec(itemId: string, spec: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  if (typeof spec !== 'string') return { ok: false, error: '잘못된 요청입니다.' }
  if (spec.length > SPEC_MAX) return { ok: false, error: '명세가 너무 큽니다(1MB 상한).' }
  const loaded = await loadItemProject(itemId)
  if (!loaded.ok) return loaded
  const g = await requireProjectAdmin(loaded.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('wbs_items').update({ spec, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  const { error: logErr } = await admin.from('change_logs').insert({
    // 본문 전문을 로그에 넣지 않는다 — 크기·노이즈. 값은 로케일 중립 토큰(SPEC_UPDATED_TOKEN) —
    // 리터럴 한국어 문자열을 저장하면 en 사용자 이력에도 그대로 노출된다(리뷰 라운드 1).
    // 렌더는 RowDetailPanel.fmtValue 가 사전 키로 변환한다.
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'spec',
    old_value: null, new_value: SPEC_UPDATED_TOKEN,
  })
  if (logErr) console.error('[wbsSpec] 명세 변경 이력 기록 실패:', logErr.message)
  revalidatePath(`/p/${loaded.projectId}`, 'layout')
  return { ok: true }
}

export async function updateWbsSpecFields(
  itemId: string,
  fields: { prd_ref?: string | null; entry_point?: string | null; priority?: WbsPriority | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  if (fields.priority !== undefined && fields.priority !== null && !PRIORITY_LABELS.has(fields.priority)) {
    return { ok: false, error: '허용되지 않는 우선순위입니다.' }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('prd_ref' in fields) patch.prd_ref = fields.prd_ref
  if ('entry_point' in fields) patch.entry_point = fields.entry_point
  if ('priority' in fields) patch.priority = fields.priority
  if (Object.keys(patch).length === 1) return { ok: false, error: '갱신할 필드가 없습니다.' }
  const loaded = await loadItemProject(itemId)
  if (!loaded.ok) return loaded
  const g = await requireProjectAdmin(loaded.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('wbs_items').update(patch).eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  revalidatePath(`/p/${loaded.projectId}`, 'layout')
  return { ok: true }
}

/** 에이전트 위임 태그 — dflow-poll 의 자동 착수 대상 판별 계약(값을 바꾸면 폴링과 어긋난다). */
const AGENT_TAG = 'agent'

const AGENT_PROMPT_MAX = 16_384 // 16KB — 프롬프트는 지시문이지 문서 저장소가 아니다(문서는 spec·prd_ref)

/**
 * 에이전트 프롬프트 저장(0090) — 위임 체크에 덧붙이는 사용자 지시문. trim 후 빈 값은 null(삭제).
 * change_logs 를 남기지 않는다 — spec 과 같은 본문성 필드이고 spec 도 토큰 로그만 남기지만,
 * 프롬프트는 수시로 다듬는 작업 메모 성격이라 이력 노이즈가 더 크다. 권한은 다른 명세 편집과
 * 동일 — 프로젝트 관리자.
 */
export async function updateAgentPrompt(
  itemId: string,
  raw: string,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof raw !== 'string') return { ok: false, error: '잘못된 요청입니다.' }
  if (raw.length > AGENT_PROMPT_MAX) return { ok: false, error: '프롬프트가 너무 큽니다(16KB 상한).' }
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const loaded = await loadItemProject(itemId)
  if (!loaded.ok) return loaded
  const g = await requireProjectAdmin(loaded.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('wbs_items')
    .update({ agent_prompt: raw.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  revalidatePath(`/p/${loaded.projectId}`, 'layout')
  return { ok: true }
}

export type AgentDelegationResult = {
  ok: boolean; error?: string
  /** 사람이 알아야 할 부수 상황 — 프로젝트가 중지 상태라 주문이 안 나갔다, 진행 중 주문은 회수하지 않았다 등. */
  warning?: string
}

/**
 * 에이전트 위임 토글(2026-08-24 재정의 — "위임 체크 = 발행"). 사람이 하는 결정은 이것 하나다:
 *
 * ON : tags 에 agent 추가 → 프로젝트 자동 활성(처음이면 백필) → dev_workflow ON(아니었으면) → 이 항목 주문 보장.
 *      프로젝트가 "에이전트 중지"(enabled=false) 상태면 태그는 붙이되 주문은 안 나간다 — warning 으로 알린다.
 * OFF: tags 에서 agent 제거 → 이 항목의 ready 주문 취소. claimed/reported 는 진행 중이라 건드리지 않고 warning.
 *
 * dev_workflow 는 여기서 켜기만 하고 끄지 않는다(위임 해제 ≠ 워크플로 이탈 — 사람이 직접 할 수도 있다).
 * 권한은 다른 명세 편집과 동일 — 프로젝트 관리자.
 */
export async function setAgentDelegation(
  itemId: string,
  delegated: boolean,
): Promise<AgentDelegationResult> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const loaded = await loadItemProject(itemId)
  if (!loaded.ok) return loaded
  const g = await requireProjectAdmin(loaded.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: row, error: readErr } = await admin
    .from('wbs_items').select('tags, dev_workflow').eq('id', itemId).single()
  if (readErr) return { ok: false, error: readErr.message }
  const tags: string[] = row?.tags ?? []
  const alreadyDelegated = tags.includes(AGENT_TAG)
  if (alreadyDelegated !== delegated) {
    const next = delegated ? [...tags, AGENT_TAG] : tags.filter(tg => tg !== AGENT_TAG)
    const { data: updated, error } = await admin
      .from('wbs_items')
      .update({ tags: next, updated_at: new Date().toISOString() })
      .eq('id', itemId).select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  }

  const warnings: string[] = []
  if (delegated) {
    // 1) 프로젝트 활성 — 처음이면 백필(활성 전에 업로드된 task 들의 주문을 여기서 채운다)
    const proj = await ensureAgentProject(admin, { projectId: loaded.projectId, actorUserId: g.actor.userId })
    if (!proj.ok) return { ok: false, error: proj.error }
    if (proj.activated) {
      const bf = await backfillProjectOrders(admin, { projectId: loaded.projectId, actorUserId: g.actor.userId })
      if (!bf.ok) warnings.push(bf.error)
      else if (bf.failed.length > 0) warnings.push(`백필 중 ${bf.failed.length}건 주문 보장 실패(서버 로그 확인)`)
    }
    // 2) dev_workflow ON — 위임은 워크플로 도입을 함의한다(체크 이중화 해소). 이미 ON 이면 no-op.
    if (row?.dev_workflow !== true) {
      const dw = await setWbsDevWorkflow(itemId, true, false)
      if (!dw.ok) return { ok: false, error: dw.error ?? 'dev_workflow 갱신 실패' }
    }
    // 3) 이 항목 주문 보장 — setWbsDevWorkflow 가 방금 발행했어도 멱등(활성 주문 있으면 skip)
    if (proj.stopped) {
      warnings.push('프로젝트가 "에이전트 중지" 상태라 주문을 발행하지 않았습니다. 설정에서 에이전트를 켜면 발행됩니다.')
    } else {
      const ord = await ensureOrderForWorkflowLeaf(admin, { projectId: loaded.projectId, wbsItemId: itemId, actorUserId: g.actor.userId })
      if (!ord.ok) return { ok: false, error: ord.error }
      if (!ord.created && ord.reason === 'not_leaf') warnings.push('리프(하위 없음) 항목만 에이전트가 집어갑니다 — 이 항목은 하위가 있어 주문이 없습니다.')
    }
  } else {
    // ready·claimed 는 체크 해제만으로 취소한다(2026-08-24 — "회수" 버튼을 따로 안 둔다: 위임을
    // 끄면 그 항목엔 에이전트를 더 안 쓰겠다는 뜻이니 대기 중이든 작업 중이든 그대로 끝낸다).
    // reported 는 이미 결과물이 올라온 상태라 취소로 지우지 않는다 — 명세 패널에서 승인·반려로만 정리한다.
    const { data: active, error: actErr } = await admin
      .from('agent_work_orders').select('id, status').eq('wbs_item_id', itemId)
      .in('status', ['ready', 'claimed', 'reported'])
    if (actErr) return { ok: false, error: `주문 조회 실패: ${actErr.message}` }
    const rows = (active ?? []) as Array<{ id: string; status: string }>
    const cancelIds = rows.filter(o => o.status === 'ready' || o.status === 'claimed').map(o => o.id)
    if (cancelIds.length > 0) {
      const { error: cancelErr } = await admin
        .from('agent_work_orders')
        .update({ status: 'cancelled', claimed_by: null, claimed_by_user_id: null, claimed_at: null, updated_at: new Date().toISOString() })
        .in('id', cancelIds).in('status', ['ready', 'claimed'])
      if (cancelErr) return { ok: false, error: `주문 취소 실패: ${cancelErr.message}` }
    }
    if (rows.some(o => o.status === 'reported')) {
      warnings.push('완료 보고가 이미 올라온 주문은 취소되지 않았습니다 — 아래 진행 상황에서 승인·반려로 정리하세요.')
    }
  }
  revalidatePath(`/p/${loaded.projectId}`, 'layout')
  return warnings.length > 0 ? { ok: true, warning: warnings.join(' ') } : { ok: true }
}
