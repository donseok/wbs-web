import { chunked } from '@/lib/ai/util'
import { treeMaxDepth, validateLevelSettings } from '@/lib/domain/levelSettings'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { emitNotification } from '@/lib/notify/emit'

/**
 * WBS 업로드(export JSON → upsert) 변환·후처리 — 계약 v2.0 §2.6.
 * 순수부(parseSchedule·assembleSpecMarkdown·toRpcNode)와 DB부(applyAssigneesAndOrders)를 분리한다.
 * 라우트(src/app/api/v1/wbs/import/route.ts)는 얇게 — 이 모듈이 규칙을 쥔다.
 */
export type SpecSections = {
  requirements: string[]; test_criteria: string[]; constraints: string[]
  api_spec: string | null; data_model: string | null; description: string | null
}
export type ImportNode = {
  id: string; parent_id: string | null; kind: 'phase' | 'act' | 'wp' | 'task'
  title: string; stage: string | null; category: string | null; domain: string | null
  assignee: string | null; schedule: string | null
  depends: string[]; acceptance: string[]
  priority: string | null // 라벨: critical/high/medium/low (계약 v2 — 결정 E)
  model: string | null; tags: string[]
  prd_ref: string | null; entry_point: string | null
  spec_sections: SpecSections | null
  // v2.2(nlevel) — levels 있는 payload 에서만 의미(스펙 §import 계약 v2.2)
  level?: number | null      // levels 배열 인덱스 → wbs_items.level_idx
  weight?: number | null     // 롤업 가중(양수). 생략 = null(형제 균등)
  milestone?: boolean        // [M] — progress none, 발행 제외
  credit?: string | null     // 크레딧 표 키 → credit_key
  if_id?: string | null      // PMO I/F 대장 참조
}

/** v2.2 — frontmatter levels 선언(층별). 서버는 구조 검증 + 발행 판정에만 쓴다. */
export type LevelDecl = {
  name: string; prefix: string
  progress: 'input' | 'rollup' | 'checklist' | 'none'
  optional?: boolean; upload?: boolean | 'fold'; report?: string; owner?: string
}
const PROGRESS_ROLES = new Set(['input', 'rollup', 'checklist', 'none'])
const LEVELS_MAX = 10 // domain/levelSettings LEVEL_LABELS_MAX 와 동일 상한(계약 공유)

/**
 * levels 선언 구조 검증(순수) — 스펙 §import 계약 v2.2.
 * name·prefix 유일, progress 4종, input 층 upload:true 강제, upload 는 아래에서 위로만,
 * input 층 최소 1개(발행 대상 없는 선언은 진도 입력 자체가 불가).
 */
export function validateLevels(raw: unknown): { levels: LevelDecl[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'levels 는 비어 있지 않은 배열이어야 합니다.' }
  if (raw.length > LEVELS_MAX) return { error: `levels 는 최대 ${LEVELS_MAX}층까지입니다.` }
  const levels: LevelDecl[] = []
  const names = new Set<string>(); const prefixes = new Set<string>()
  let uploadCut = false // 한 층이 false/fold 면 그보다 깊은 층 전부 동일해야 한다
  let hasInput = false
  for (const [i, l] of (raw as Array<Record<string, unknown>>).entries()) {
    const name = typeof l?.name === 'string' ? l.name.trim() : ''
    const prefix = typeof l?.prefix === 'string' ? l.prefix.trim() : ''
    if (!name || !prefix) return { error: `levels[${i}]: name·prefix 필수` }
    if (names.has(name)) return { error: `levels name 중복: ${name}` }
    if (prefixes.has(prefix)) return { error: `levels prefix 중복: ${prefix}` }
    names.add(name); prefixes.add(prefix)
    const progress = l.progress
    if (typeof progress !== 'string' || !PROGRESS_ROLES.has(progress)) {
      return { error: `levels[${i}] progress 허용 밖: ${String(progress)}` }
    }
    const upload = l.upload === undefined ? true : l.upload
    if (upload !== true && upload !== false && upload !== 'fold') {
      return { error: `levels[${i}] upload 허용 밖: ${String(l.upload)}` }
    }
    if (progress === 'input' && upload !== true) {
      return { error: `levels[${i}] (${name}): input 층은 upload:true 강제 — 발행 대상이 안 올라가면 모순` }
    }
    // "아래에서 위로만" 규칙의 예외: 선두 연속 upload:false 는 PL 파일의 골격층 선언(본문 금지,
    // 접두어 해석용 — attach 가 부모를 잇는다)이라 그 아래 true 가 정상이다(E2E 2026-08-22 실측).
    // fold 는 선두여도 접힐 부모가 없으므로 예외 없음.
    const leadingSkeleton = upload === false && !uploadCut && levels.every(l => l.upload === false)
    if (uploadCut && upload === true) {
      return { error: `levels[${i}] (${name}): upload 는 아래에서 위로만 끌 수 있다 — 위층이 false/fold 인데 아래층이 true` }
    }
    if (upload !== true && !leadingSkeleton) uploadCut = true
    if (progress === 'input') hasInput = true
    levels.push({
      name, prefix, progress: progress as LevelDecl['progress'],
      optional: l.optional === true, upload: upload as LevelDecl['upload'],
      report: typeof l.report === 'string' ? l.report : undefined,
      owner: typeof l.owner === 'string' ? l.owner : undefined,
    })
  }
  if (!hasInput) return { error: 'levels 에 progress:input 층이 최소 1개 필요합니다.' }
  return { levels }
}
const STAGES = new Set(['as', 'fp', 'ip', 'im', 'xx'])
const PRIORITY_LABELS = new Set(['critical', 'high', 'medium', 'low'])
const SCHEDULE_RE = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/
const SCHEDULE_END_ONLY_RE = /^~\s*(\d{4}-\d{2}-\d{2})$/ // v2.2: nlevel wbs.md 의 ~종료일 토큰(시작일 없음)

export function parseSchedule(s: string | null): { start: string | null; end: string | null } | { error: string } {
  if (!s) return { start: null, end: null }
  const m = SCHEDULE_RE.exec(s.trim())
  if (m) return { start: m[1], end: m[2] }
  const e = SCHEDULE_END_ONLY_RE.exec(s.trim())
  if (e) return { start: null, end: e[1] }
  return { error: `schedule 형식 오류: ${s}` }
}

/** spec_sections → 마크다운 조립 — 섹션 순서는 계약 고정(결정 E): 머리말 → 요구사항 → 제약 → 테스트 기준 → API 스펙 → 데이터 모델. 빈 섹션 생략. */
export function assembleSpecMarkdown(s: SpecSections | null): string | null {
  if (!s) return null
  const parts: string[] = []
  if (s.description) parts.push(s.description.trim())
  const list = (title: string, items: string[]) => {
    if (items.length > 0) parts.push(`## ${title}\n${items.map(i => `- ${i}`).join('\n')}`)
  }
  list('요구사항', s.requirements ?? [])
  list('제약', s.constraints ?? [])
  list('테스트 기준', s.test_criteria ?? [])
  if (s.api_spec) parts.push(`## API 스펙\n${s.api_spec.trim()}`)
  if (s.data_model) parts.push(`## 데이터 모델\n${s.data_model.trim()}`)
  return parts.length > 0 ? parts.join('\n\n') : null
}

export function toRpcNode(module: string, n: ImportNode, index: number, levels?: LevelDecl[] | null):
  | { external_ref: string; parent_external_ref: string | null; title: string
      stage: string | null; planned_start: string | null; planned_end: string | null
      sort_order: number; assignee: string | null
      category: string | null; domain: string | null; priority: string | null
      model: string | null; tags: string[]; depends: string[]
      prd_ref: string | null; entry_point: string | null
      acceptance: string[]; spec: string | null; dev_workflow: boolean
      level_idx: number | null; weight: number | null; milestone: boolean
      credit_key: string | null; if_id: string | null }
  | { error: string } {
  if (!n.id || !n.title) return { error: `id·title 필수: ${JSON.stringify(n.id)}` }
  // v2.1: 'todo' 는 stage 축에서 제거됐다(0082) — 검증 전에 null 로 정규화해 하위호환 수용.
  const stage = n.stage === 'todo' ? null : n.stage
  if (stage !== null && stage !== undefined && !STAGES.has(stage)) return { error: `허용 밖 stage: ${stage} (${n.id})` }
  if (n.priority !== null && n.priority !== undefined && !PRIORITY_LABELS.has(n.priority)) {
    return { error: `허용 밖 priority 라벨: ${n.priority} (${n.id})` }
  }
  const sched = parseSchedule(n.schedule)
  if ('error' in sched) return { error: `${sched.error} (${n.id})` }
  // v2.2 — levels 문맥: level 인덱스 필수·범위 검증, 발행 판정은 progress:input(마일스톤 제외).
  const milestone = n.milestone === true
  let levelIdx: number | null = null
  if (levels && levels.length > 0) {
    if (typeof n.level !== 'number' || !Number.isInteger(n.level) || n.level < 0 || n.level >= levels.length) {
      return { error: `level 인덱스 누락/범위 밖: ${String(n.level)} (${n.id})` }
    }
    levelIdx = n.level
  }
  if (n.weight !== undefined && n.weight !== null) {
    if (typeof n.weight !== 'number' || !Number.isFinite(n.weight) || n.weight <= 0) {
      return { error: `weight 는 양수만: ${String(n.weight)} (${n.id})` }
    }
  }
  const devWorkflow = levels && levelIdx !== null
    ? levels[levelIdx].progress === 'input' && !milestone
    : n.kind === 'task' // v2.1 레거시 규칙 유지(levels 없는 payload)
  return {
    external_ref: `${module}/${n.id}`,
    parent_external_ref: n.parent_id ? `${module}/${n.parent_id}` : null,
    title: n.title, stage: stage ?? null,
    planned_start: sched.start, planned_end: sched.end,
    sort_order: index, // 파일 내 등장 순서가 정렬 정본 — priority 는 정렬이 아니라 라벨(결정 E)
    assignee: n.assignee ? n.assignee.trim().toLowerCase() : null,
    category: n.category ?? null, domain: n.domain ?? null, priority: n.priority ?? null,
    model: n.model ?? null, tags: n.tags ?? [],
    depends: (n.depends ?? []).map(d => `${module}/${d}`), // 선행도 external_ref 로 저장(결정 C 게이트 키)
    prd_ref: n.prd_ref ?? null, entry_point: n.entry_point ?? null,
    acceptance: n.acceptance ?? [], spec: assembleSpecMarkdown(n.spec_sections),
    dev_workflow: devWorkflow, // v2.2: levels 있으면 progress:input 층(마일스톤 제외), 없으면 kind==='task'(v2.1)
    level_idx: levelIdx, weight: n.weight ?? null, milestone,
    credit_key: n.credit ?? null, if_id: n.if_id ?? null,
  }
}

/**
 * import 실행 코어(v2.2) — 인증 이후의 전 과정: levels 시드/정합·attach 해석·노드 변환·
 * RPC upsert·배정·자동 발행. API 라우트(PAT)와 웹 업로드 액션(세션)이 공유한다 —
 * 두 경로의 검증·순서가 갈라지면 안 되므로 여기 밖에서 이 시퀀스를 재구현하지 않는다.
 */
export type RunWbsImportResult =
  | { ok: true; upserted: number; skipped: number
      unmatched: Array<{ id: string; assignee: string }>; nonLeafSkipped: string[]; ordersCreated: number }
  | { ok: false; code: 'validation_failed' | 'levels_mismatch' | 'attach_not_found' | 'apply_failed'; message: string }

export async function runWbsImport(
  admin: AdminClient,
  args: { projectId: string; module: string; actorUserId: string
    levels: LevelDecl[] | null; attachRef: string | null; nodes: ImportNode[] },
): Promise<RunWbsImportResult> {
  const { projectId, module: module_, actorUserId, levels, attachRef, nodes } = args

  // levels·attach 의 DB 대조 (스펙 §import 계약 v2.2)
  let attachId: string | null = null
  if (levels && attachRef) {
    // PL 업로드: levels 는 서버 정본(level_labels)과 완전 일치해야 통과(불일치 = 파일이 낡음).
    const { data: ps, error: psErr } = await admin
      .from('project_settings').select('level_labels').eq('project_id', projectId).maybeSingle()
    if (psErr) throw new Error(`프로젝트 설정 조회 실패: ${psErr.message}`)
    const serverLabels = (ps as { level_labels: string[] } | null)?.level_labels ?? null
    const payloadLabels = levels.map(l => l.name)
    if (!serverLabels || JSON.stringify(serverLabels) !== JSON.stringify(payloadLabels)) {
      return { ok: false, code: 'levels_mismatch',
        message: `levels 가 프로젝트 정본과 다릅니다. 골격의 levels 를 다시 복사하세요. (정본: ${serverLabels?.join('>') ?? '없음'})` }
    }
    // attach 노드 해석(크로스 모듈 external_ref) — 없으면 fail-closed(골격 선행의 기계 검증).
    const { data: attachRow, error: attachErr } = await admin
      .from('wbs_items').select('id').eq('project_id', projectId).eq('external_ref', attachRef).maybeSingle()
    if (attachErr) throw new Error(`attach 노드 조회 실패: ${attachErr.message}`)
    if (!attachRow) return { ok: false, code: 'attach_not_found',
      message: `attach 노드가 없습니다: ${attachRef} — 골격을 먼저 업로드하세요.` }
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
    if (!v.ok) return { ok: false, code: 'validation_failed', message: `levels 시드 실패: ${v.error}` }
    const { error: seedErr } = await admin.from('project_settings').upsert({
      project_id: projectId, level_labels: v.labels, max_depth: v.maxDepth,
      updated_at: new Date().toISOString(), updated_by: actorUserId,
    })
    if (seedErr) throw new Error(`levels 시드 실패: ${seedErr.message}`)
  }

  // 변환 — 실패 노드는 생략하지 않고 전량 보고(에러 3원칙).
  const rpcNodes: unknown[] = []
  const assigneeByRef: Record<string, string | null> = {}
  const titleByRef: Record<string, string> = {}
  const kindByRef: Record<string, string> = {}
  const errors: string[] = []
  for (const [i, nRaw] of nodes.entries()) {
    const r = toRpcNode(module_, nRaw, i, levels)
    if ('error' in r) { errors.push(r.error); continue }
    rpcNodes.push(r)
    assigneeByRef[r.external_ref] = r.assignee
    titleByRef[r.external_ref] = r.title
    // 주문 보장 대상 판정 — v2.2: dev_workflow 가 정본(levels 있으면 input 층, 없으면 kind==='task' 와 동치).
    kindByRef[r.external_ref] = r.dev_workflow ? 'task' : nRaw.kind ?? 'other'
  }
  if (errors.length > 0) {
    return { ok: false, code: 'validation_failed',
      message: `노드 변환 실패 ${errors.length}건: ${errors.slice(0, 5).join(' / ')}` }
  }

  // p_attach_id 는 attach 경로에서만 싣는다 — 레거시 payload 는 구 2인자 시그니처와도 호환(배포 순서 안전).
  const { data: rpcOut, error: rpcErr } = await admin
    .rpc('import_wbs_upsert', attachId
      ? { p_project_id: projectId, p_nodes: rpcNodes, p_attach_id: attachId }
      : { p_project_id: projectId, p_nodes: rpcNodes })
  if (rpcErr) {
    console.error('[wbs-import] upsert 실패:', rpcErr.message)
    return { ok: false, code: 'apply_failed', message: `업로드 실패: ${rpcErr.message}` }
  }
  const out = rpcOut as { upserted: number; skipped: number; ids: Record<string, string>; new_refs: string[] }

  const post = await applyAssigneesAndOrders(admin, {
    projectId, actorUserId, module: module_,
    newRefs: out.new_refs, idsByRef: out.ids, assigneeByRef, titleByRef, kindByRef,
  })
  return { ok: true, upserted: out.upserted, skipped: out.skipped,
    unmatched: post.unmatched, nonLeafSkipped: post.nonLeafSkipped, ordersCreated: post.ordersCreated }
}

/**
 * 업로드 후처리 — 신규 리프의 assignee email 을 로스터에 매칭하고 자동 발행까지(§2.6·§2.8).
 * v2.1: 주문 보장은 더 이상 "assignee 있는 신규 ref"가 아니라 "kind='task' 인 모든 신규 ref" 대상이다
 * (배정은 조건이 아니다 — dev_workflow 는 RPC 가 이미 심었고, 리프·활성주문 게이트는 ensureOrderForWorkflowLeaf 내부 판정).
 * v2.2(F1, 최종 리뷰): 주문 보장은 신규 ref 로 국한하지 않는다 — RPC 는 재업로드 시 기존 행도
 * dev_workflow=true 로 갱신하는데, 과거엔 주문 보장 루프가 newRefs 만 순회해 "재업로드로 기존
 * task 가 dev_workflow ON 됐지만 활성 주문은 없는" 갭이 생겼다(불변식 파괴). 이제 payload 전체의
 * task ref(신규+기존)를 대상으로 갭만 채운다 — ensureOrdersForPayload 참조.
 * assignee 매칭(email→member, unmatched 리포트, work.assigned 알림)은 종전대로 신규 ref 만 대상.
 */
export async function applyAssigneesAndOrders(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string; module: string
    newRefs: string[]; idsByRef: Record<string, string>
    assigneeByRef: Record<string, string | null>; titleByRef: Record<string, string>
    kindByRef: Record<string, string> },
): Promise<{ unmatched: Array<{ id: string; assignee: string }>; ordersCreated: number; nonLeafSkipped: string[] }> {
  const { projectId, actorUserId, module } = args
  const unmatched: Array<{ id: string; assignee: string }> = []
  // 로스터 email → member_id 맵 1회 로드
  const { data: members, error } = await admin
    .from('project_members').select('id, email').eq('project_id', projectId)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  const memberByEmail = new Map<string, string>()
  for (const m of (members ?? []) as Array<{ id: string; email: string | null }>) {
    if (m.email) memberByEmail.set(m.email.toLowerCase(), m.id)
  }
  for (const ref of args.newRefs) {
    const itemId = args.idsByRef[ref]
    if (!itemId) continue
    const email = args.assigneeByRef[ref]
    if (!email) continue
    const memberId = memberByEmail.get(email)
    if (!memberId) {
      // 계약(api-contract.md §2.6): 클라이언트는 bare id만 안다 — external_ref 조합은 서버 책임이므로
      // 응답도 bare id로 되돌린다(module 프리픽스 + "/" 제거).
      unmatched.push({ id: ref.slice(module.length + 1), assignee: email }) // 생략하지 않고 전량 리포트
      continue
    }
    const { error: upErr } = await admin
      .from('wbs_items').update({ assignee_member_id: memberId }).eq('id', itemId)
    if (upErr) throw new Error(`담당자 반영 실패(${ref}): ${upErr.message}`)
    // 담당자 매칭 알림 — fire-and-forget(본 로직 실패로 이어지지 않음). 재업로드 멱등은 dedupeKey 로 보증.
    emitNotification({
      type: 'work.assigned',
      projectId,
      entityType: 'wbs_item',
      entityId: itemId,
      payload: {
        title: args.titleByRef[ref] ?? ref,
        detail: '작업이 배정되었습니다',
        href: `/p/${projectId}/wbs`,
      },
      recipientMemberIds: [memberId],
      dedupeKey: `assigned:${ref}:${memberId}`,
    }).catch(() => {
      // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않음(emitNotification 내부에서 로깅)
    })
  }

  // 주문 보장 — payload 의 전체 task ref(신규+기존) 대상, 갭만 채운다(F1, 최종 리뷰).
  const taskRefs = Object.keys(args.kindByRef).filter(ref => args.kindByRef[ref] === 'task')
  const { ordersCreated, nonLeafSkipped } = await ensureOrdersForPayload(admin, { projectId, actorUserId, module, taskRefs })
  return { unmatched, ordersCreated, nonLeafSkipped }
}

/**
 * F1(최종 리뷰) — payload 의 task ref 전체(신규+기존) 중 "dev_workflow ON인데 활성 주문이
 * 없는" 갭만 골라 ensureOrderForWorkflowLeaf 를 호출한다. 전량 순회 대신 배치 2쿼리로 갭
 * 집합을 구해 MAX_NODES(1000) 규모에서도 쿼리 수를 상수로 유지한다.
 * .in() 인자는 이번 payload 의 task ref 만이다(프로젝트 전체가 아니다 — 무한정 커지지 않는다).
 */
/** .in() 인자 청크 크기 — supabase-js 필터는 GET 쿼리스트링으로 나가므로 MAX_NODES(1000)를
 *  한 번에 실으면 UUID 1000개 ≈ 37KB 가 프록시 URI 상한(8~16KB)을 넘는다(재리뷰 지적). */
const IN_CHUNK = 200

async function ensureOrdersForPayload(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string; module: string; taskRefs: string[] },
): Promise<{ ordersCreated: number; nonLeafSkipped: string[] }> {
  const { projectId, actorUserId, module, taskRefs } = args
  const nonLeafSkipped: string[] = []
  let ordersCreated = 0
  if (taskRefs.length === 0) return { ordersCreated, nonLeafSkipped }

  // 배치 조회(청크당 1쿼리) — 이번 payload 의 task ref 전체를 조회하고 dev_workflow=true 후보만 client 측에서 거른다.
  const rows: Array<{ id: string; external_ref: string | null; dev_workflow: boolean | null }> = []
  for (const refChunk of chunked(taskRefs, IN_CHUNK)) {
    const { data, error: rowsErr } = await admin
      .from('wbs_items')
      .select('id, external_ref, dev_workflow')
      .eq('project_id', projectId)
      .in('external_ref', refChunk)
    if (rowsErr) throw new Error(`주문 대상 조회 실패: ${rowsErr.message}`)
    rows.push(...((data ?? []) as typeof rows))
  }
  const candidates = rows.filter(r => r.dev_workflow === true)
  if (candidates.length === 0) return { ordersCreated, nonLeafSkipped }

  // 배치 조회(청크당 1쿼리) — 후보 id 들의 활성 주문(ready/claimed/reported), 이미 있는 id 는 갭에서 제외.
  const candidateIds = candidates.map(c => c.id)
  const activeIds = new Set<string | null>()
  for (const idChunk of chunked(candidateIds, IN_CHUNK)) {
    const { data: active, error: activeErr } = await admin
      .from('agent_work_orders')
      .select('wbs_item_id')
      .in('wbs_item_id', idChunk)
      .in('status', ['ready', 'claimed', 'reported'])
    if (activeErr) throw new Error(`활성 주문 조회 실패: ${activeErr.message}`)
    for (const r of (active ?? []) as Array<{ wbs_item_id: string | null }>) activeIds.add(r.wbs_item_id)
  }

  // 차집합(갭)에만 ensureOrderForWorkflowLeaf 호출 — 신규든 기존이든 이 루프 하나로 통일한다.
  for (const c of candidates) {
    if (activeIds.has(c.id)) continue
    const ensured = await ensureOrderForWorkflowLeaf(admin, { projectId, wbsItemId: c.id, actorUserId })
    if (!ensured.ok) throw new Error(`자동 발행 실패(${c.external_ref ?? c.id}): ${ensured.error}`)
    if (ensured.created) ordersCreated += 1
    // unmatched_assignees 와 동일 규칙(bare id) — 클라이언트는 module 프리픽스를 모른다.
    if (ensured.reason === 'not_leaf' && c.external_ref) {
      nonLeafSkipped.push(c.external_ref.slice(module.length + 1))
    }
  }
  return { ordersCreated, nonLeafSkipped }
}
