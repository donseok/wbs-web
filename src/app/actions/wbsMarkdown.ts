'use server'

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWbsImport, toRpcNode, validateLevels, type ImportNode, type LevelDecl } from '@/lib/agent/wbsImport'
import { ensureAgentProject } from '@/lib/agent/ensureOrder'
import { parseWbsMarkdown, toImportNodes, validateWbsDoc, type WbsDoc } from '@/lib/wbsmd/parse'
import { detectWbsFormat, parseClassicWbs, type WbsFormat } from '@/lib/wbsmd/classic'
import { chunked } from '@/lib/ai/util'

/**
 * wbs.md 웹 업로드 — 스펙 §업로드 경로 2개의 "웹 경로(자동 부착 + 확인)".
 * 미리보기(previewWbsUpload)가 부착점·levels 정합·신규/갱신을 보여주고, 사람은 노드를 고르지
 * 않고 확인만 한다. 적용(applyWbsUpload)은 클라이언트 미리보기를 신뢰하지 않고 전 과정을
 * 다시 검증한 뒤 API 라우트와 같은 코어(runWbsImport)를 태운다 — 두 경로의 규칙 분기 금지.
 * 권한: 프로젝트 관리자 전용(import API 와 동일).
 *
 * 받는 형식 두 가지(2026-10-19) — 형식은 파일 내용으로 판정한다(detectWbsFormat).
 *  - nlevel: frontmatter levels 계약(N단). 아래 종전 경로 그대로.
 *  - classic: dflow-wbs 기존 3~4단(## WP- / ### TSK-). 스킬 dflow-export 가 JSON v2.1 로 바꿔 API 에 올리던 형식을
 *    화면에서 바로 받는다. levels·attach 가 없으므로 API 라우트가 levels 없이 호출할 때(route.ts levels=null)와
 *    같게 runWbsImport 를 태운다. 파일에 module 이 없어 사람이 정한다(미리보기가 제안, 적용은 명시 필수).
 */

export type WbsUploadPreview = {
  ok: boolean
  error?: string
  /** 판정된 파일 형식. unknown 은 N단 검증을 그대로 보여 주고 받는 형식 안내를 덧붙인다. */
  format?: WbsFormat
  mode?: 'skeleton' | 'pl'
  module?: string
  /** classic 전용 — 이 프로젝트 기존 external_ref(기존 형식·레거시 행)의 module 접두어 최빈값. 없으면 null. */
  moduleSuggested?: string | null
  attach?: string                    // frontmatter 표기 (PH-03/SYS-QA)
  attachRef?: string | null          // 해석된 full external_ref (mes-skel/SYS-QA)
  attachFound?: boolean
  levelsStatus?: 'match' | 'mismatch' | 'seed'
  serverLevels?: string[] | null
  fileLevels?: string[]
  counts?: Record<string, number>
  newCount?: number
  updateCount?: number
  foldCount?: number
  errors?: string[]
  warnings?: string[]
  canApply?: boolean
}

/** classic 파일의 module — 미리보기는 생략 가능(서버 제안), 적용은 필수. nlevel 파일은 frontmatter module 을 쓰고 이 값을 무시한다. */
export type WbsUploadOptions = { module?: string }

export type WbsUploadApplyResult = {
  ok: boolean; error?: string
  upserted?: number; ordersCreated?: number
  unmatched?: Array<{ id: string; assignee: string }>
  /** payload 의 task(input 층) 노드 수 — ordersCreated 와 대조해 "침묵 0건"을 화면이 잡는다. */
  taskCount?: number
  /** 프로젝트가 "에이전트 중지" 상태라 주문이 안 나간 경우 — 사람이 설정에서 켜야 한다. */
  agentStopped?: boolean
  /** L7(리뷰 수정 1회차) — 위임 표식이 빠진 항목의 ready·claimed 주문을 취소한 건수. PAT 응답과 같은
   *  정보를 웹 업로드 사용자에게도 보여준다("새 칸은 PAT 응답에만"은 레거시 v1 API 규칙이라 서버
   *  액션엔 해당 없다). */
  delegationCancelled?: number
  /** 취소를 끝내지 못한 항목의 bare id — 있으면 사용자가 직접 「중단」하거나 위임을 껐다 켜야 한다. */
  delegationCancelFailed?: string[]
}

type Admin = ReturnType<typeof createAdminClient>

/** API 라우트(route.ts)와 같은 module 규칙 — external_ref 의 앞부분이 된다. */
const MODULE_RE = /^[A-Za-z0-9_-]{1,32}$/
/** API 라우트 MAX_NODES 와 같은 상한 — classic 은 그 경로로 올라가던 형식이라 같은 문턱을 둔다. */
const CLASSIC_MAX_NODES = 1000
/** 한 페이지 크기 — PostgREST max_rows(Supabase 기본 1000)와 같다. */
const REF_PAGE = 1000

const FORMAT_HINT =
  '받는 형식은 두 가지입니다 — ① N단: frontmatter 에 levels 를 선언한 wbs.md, ② 기존 3~4단: "## WP-01:" 아래 '
  + '"### TSK-01-01:"(4단은 "### ACT-01-01:" 아래 "#### TSK-01-01-01:") 헤딩을 쓴 wbs.md. 이 파일은 어느 쪽으로도 판정되지 않았습니다.'

/** 파싱 + 구조·본문 검증 — 미리보기·적용이 공유하는 앞단. */
function parseAndValidate(md: string): { doc: WbsDoc; role: 'pl' | 'skeleton'; errors: string[]; warnings: string[]; counts: Record<string, number> } {
  const doc = parseWbsMarkdown(md)
  const role: 'pl' | 'skeleton' = doc.front.attach ? 'pl' : 'skeleton'
  const errors: string[] = []
  const lv = validateLevels(doc.levels)
  if ('error' in lv) errors.push(`levels 검증 실패: ${lv.error}`)
  const v = validateWbsDoc(doc, role)
  errors.push(...v.errors)
  return { doc, role, errors, warnings: v.warnings, counts: v.counts }
}

/** attach 경로 표기(PH-03/SYS-OP)의 마지막 세그먼트를 full external_ref 로 해석.
 *  0건 = 골격 미업로드(fail-closed 표시), 2건+ = 모호(에러 — 자동 부착 불가). */
async function resolveAttachRef(admin: Admin, projectId: string, attach: string):
  Promise<{ ref: string | null; ambiguous: boolean }> {
  const last = attach.split('/').pop() ?? ''
  const { data, error } = await admin
    .from('wbs_items').select('external_ref')
    .eq('project_id', projectId).like('external_ref', `%/${last}`).limit(2)
  if (error) throw new Error(`attach 해석 실패: ${error.message}`)
  const rows = (data ?? []) as Array<{ external_ref: string }>
  if (rows.length === 1) return { ref: rows[0].external_ref, ambiguous: false }
  return { ref: null, ambiguous: rows.length > 1 }
}

// ── classic(기존 3~4단) ─────────────────────────────────────────────────────

type RefRow = { external_ref: string; level_idx: number | null; stub_for: string | null }

/** 프로젝트의 external_ref 전량 — 페이지로 끝까지 읽는다(max_rows 에서 조용히 잘리면 갱신이 신규로 보이고
 *  N단 겹침 검사가 빠진다). 조회 실패는 throw(쓰기 전 선행 조회 실패 = 중단). */
async function readProjectRefs(admin: Admin, projectId: string): Promise<RefRow[]> {
  const out: RefRow[] = []
  for (let from = 0; ; from += REF_PAGE) {
    const { data, error } = await admin
      .from('wbs_items').select('external_ref, level_idx, stub_for')
      .eq('project_id', projectId).not('external_ref', 'is', null)
      .order('id').range(from, from + REF_PAGE - 1)
    if (error) throw new Error(`기존 노드 조회 실패: ${error.message}`)
    const rows = (data ?? []) as RefRow[]
    out.push(...rows)
    if (rows.length < REF_PAGE) return out
  }
}

/**
 * module 제안 — 기존 external_ref 의 module 접두어 중 가장 많은 것(동률이면 사전순 앞).
 * level_idx 가 있는 행(N단 업로드)은 세지 않는다: N단 프로젝트에서 PL module 이 제안되면 classic 파일이
 * 그 module 의 N단 노드와 부딪친다. 스텁 하위(0103)는 업로드 산물이 아니라 뺀다.
 */
function suggestModule(rows: RefRow[]): string | null {
  const count = new Map<string, number>()
  for (const r of rows) {
    if (r.level_idx !== null || r.stub_for) continue
    const i = r.external_ref.indexOf('/')
    if (i <= 0) continue
    const m = r.external_ref.slice(0, i)
    if (MODULE_RE.test(m)) count.set(m, (count.get(m) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [m, n] of count) {
    if (n > bestN || (n === bestN && best !== null && m < best)) { best = m; bestN = n }
  }
  return best
}

const KIND_LABEL: Record<ImportNode['kind'], string> = { phase: 'Phase', wp: 'WP', act: 'ACT', task: 'TSK' }

/**
 * classic 검증 — 미리보기·적용이 공유한다(적용은 클라이언트를 믿지 않고 이것을 다시 돈다).
 * 적용 코어가 거부할 조건(toRpcNode·module 규칙·노드 상한)과, 코어는 막지 않지만 데이터를 망가뜨리는 조건
 * (ID 중복 = 뒤 노드가 앞 노드를 조용히 덮음, N단 노드 덮어쓰기)을 에러로 낸다.
 */
function checkClassic(nodes: ImportNode[], module_: string, rows: RefRow[]): {
  errors: string[]; warnings: string[]; counts: Record<string, number>; newCount?: number; updateCount?: number
} {
  const errors: string[] = []
  const warnings: string[] = []
  const counts: Record<string, number> = {}
  for (const n of nodes) counts[KIND_LABEL[n.kind]] = (counts[KIND_LABEL[n.kind]] ?? 0) + 1

  if (nodes.length > CLASSIC_MAX_NODES) {
    errors.push(`노드가 ${nodes.length}개입니다 — 한 번에 ${CLASSIC_MAX_NODES}개까지 올릴 수 있습니다(import API 와 같은 상한).`)
  }
  const ids = new Set<string>()
  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`ID 중복: ${n.id}`)
    ids.add(n.id)
  }
  for (const n of nodes) {
    for (const d of n.depends) if (!ids.has(d)) warnings.push(`${n.id}: depends 대상 없음(파일 내): ${d}`)
  }

  const moduleOk = MODULE_RE.test(module_)
  if (!module_) errors.push('module 을 입력하세요 — 기존 형식 파일에는 module 이 없어 external_ref(module/ID)를 만들 수 없습니다.')
  else if (!moduleOk) errors.push('module 형식이 올바르지 않습니다 — 영문·숫자·_·- 1~32자.')

  // 적용 코어와 같은 변환(levels=null) — stage·priority·schedule 등 거부 조건을 미리 보여 준다.
  for (const [i, n] of nodes.entries()) {
    const r = toRpcNode(module_, n, i, null)
    if ('error' in r) errors.push(r.error)
  }
  if (!moduleOk) return { errors, warnings, counts }

  const byRef = new Map(rows.map(r => [r.external_ref, r] as const))
  let updateCount = 0
  const nlevelHits: string[] = []
  for (const n of nodes) {
    const hit = byRef.get(`${module_}/${n.id}`)
    if (!hit) continue
    updateCount += 1
    if (hit.level_idx !== null) nlevelHits.push(n.id)
  }
  // levels=null 업로드는 겹친 행의 level_idx·weight·milestone·credit_key·if_id 를 null/false 로 덮고(0096 RPC
  // do update), 부모가 없는 노드를 attach 대신 루트로 옮긴다 — N단 트리가 조용히 망가지므로 막는다.
  if (nlevelHits.length > 0) {
    errors.push(`N단(levels 계약) 노드 ${nlevelHits.length}건과 external_ref 가 겹칩니다: `
      + `${nlevelHits.slice(0, 5).join(', ')}${nlevelHits.length > 5 ? ' 외' : ''} — 기존 형식으로 덮으면 단계·가중치·`
      + '마일스톤·크레딧이 지워지고 부착점에서 떨어집니다. 다른 module 을 쓰세요.')
  } else if (rows.some(r => r.level_idx !== null)) {
    warnings.push('이 프로젝트에는 N단(levels 계약) 노드가 있습니다. 기존 형식 트리는 루트에 따로 붙고 단계 이름은 '
      + '깊이로 표시됩니다(WP 가 1단 이름으로 보입니다). 이 프로젝트에 올릴 파일이 맞는지 확인하세요.')
  }
  return { errors, warnings, counts, newCount: nodes.length - updateCount, updateCount }
}

async function previewClassic(projectId: string, md: string, opts?: WbsUploadOptions): Promise<WbsUploadPreview> {
  const nodes = parseClassicWbs(md)
  const admin = createAdminClient()
  const rows = await readProjectRefs(admin, projectId)
  const suggested = suggestModule(rows)
  // 클라이언트 입력이라 형을 믿지 않는다 — 문자열이 아니면 지정하지 않은 것으로 본다.
  const module_ = typeof opts?.module === 'string' ? opts.module.trim() : (suggested ?? '')
  const c = checkClassic(nodes, module_, rows)
  return {
    ok: true,
    format: 'classic',
    module: module_,
    moduleSuggested: suggested,
    counts: c.counts,
    newCount: c.newCount,
    updateCount: c.updateCount,
    errors: c.errors,
    warnings: c.warnings,
    canApply: c.errors.length === 0,
  }
}

// ── 공용 ──────────────────────────────────────────────────────────────────

export async function previewWbsUpload(projectId: string, md: string, opts?: WbsUploadOptions): Promise<WbsUploadPreview> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  try {
    const format = detectWbsFormat(md)
    if (format === 'classic') return await previewClassic(projectId, md, opts)

    const { doc, role, errors, warnings, counts } = parseAndValidate(md)
    if (format === 'unknown') errors.unshift(FORMAT_HINT)
    const admin = createAdminClient()

    // attach 자동 판정 (PL 만)
    let attachRef: string | null = null
    let attachFound = false
    if (role === 'pl' && doc.front.attach) {
      const r = await resolveAttachRef(admin, projectId, doc.front.attach)
      attachRef = r.ref
      attachFound = r.ref !== null
      if (r.ambiguous) errors.push(`attach 부착점이 모호합니다(같은 ID 가 여러 모듈에 있음): ${doc.front.attach}`)
      else if (!attachFound) errors.push(`attach 노드가 서버에 없습니다: ${doc.front.attach} — 골격을 먼저 업로드하세요.`)
    }

    // levels 정합 (PL: 정본 대조 / 골격: 시드 예정)
    let levelsStatus: WbsUploadPreview['levelsStatus'] = 'seed'
    let serverLevels: string[] | null = null
    if (role === 'pl') {
      const { data: ps, error: psErr } = await admin
        .from('project_settings').select('level_labels').eq('project_id', projectId).maybeSingle()
      if (psErr) throw new Error(`프로젝트 설정 조회 실패: ${psErr.message}`)
      serverLevels = (ps as { level_labels: string[] } | null)?.level_labels ?? null
      const fileLabels = doc.levels.map(l => l.name)
      levelsStatus = serverLevels && JSON.stringify(serverLevels) === JSON.stringify(fileLabels) ? 'match' : 'mismatch'
      if (levelsStatus === 'mismatch') {
        errors.push(`levels 가 프로젝트 정본과 다릅니다 (정본: ${serverLevels?.join('>') ?? '없음'}) — 골격의 levels 를 다시 복사하세요.`)
      }
    }

    // 신규/갱신 분류 — 업로드될 노드의 external_ref 존재 조회
    const module_ = doc.front.module ?? ''
    const nodes = toImportNodes(doc)
    const refs = nodes.map(n => `${module_}/${n.id}`)
    const existing = new Set<string>()
    for (const refChunk of chunked(refs, 200)) {
      const { data, error } = await admin
        .from('wbs_items').select('external_ref')
        .eq('project_id', projectId).in('external_ref', refChunk)
      if (error) throw new Error(`기존 노드 조회 실패: ${error.message}`)
      for (const r of (data ?? []) as Array<{ external_ref: string }>) existing.add(r.external_ref)
    }
    const updateCount = refs.filter(r => existing.has(r)).length
    const foldCount = doc.nodes.filter(n => doc.levels[n.level]?.upload === 'fold').length

    return {
      ok: true,
      format,
      mode: role,
      module: module_ || undefined,
      attach: doc.front.attach,
      attachRef,
      attachFound,
      levelsStatus,
      serverLevels,
      fileLevels: doc.levels.map(l => l.name),
      counts,
      newCount: refs.length - updateCount,
      updateCount,
      foldCount,
      errors,
      warnings,
      canApply: errors.length === 0 && (role === 'skeleton' || (attachFound && levelsStatus === 'match')),
    }
  } catch (e) {
    console.error('[wbs-md] 미리보기 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: e instanceof Error ? e.message : '미리보기에 실패했습니다.' }
  }
}

/** 검증을 통과한 업로드의 실행 — 두 형식이 같은 코어·같은 후처리를 탄다(규칙 분기 금지). */
async function runImportAndReport(admin: Admin, args: {
  projectId: string; module: string; actorUserId: string
  levels: LevelDecl[] | null; attachRef: string | null; nodes: ImportNode[]
}): Promise<WbsUploadApplyResult> {
  const { projectId, nodes } = args
  const taskCount = nodes.filter(n => n.kind === 'task').length
  // 프로젝트 자동 활성(2026-08-24) — task 가 있는 업로드는 dev_workflow 를 심으므로 "에이전트에게 일을 시키는
  // 행위"다. 업로드 전에 활성해야 runWbsImport 안의 주문 보장이 첫 업로드부터 발행한다(종전엔 /agent-ops
  // "루프 등록"이 먼저여야 했고, 순서가 바뀌면 주문 0건인 채 침묵했다). 중지(enabled=false)면 되살리지 않는다.
  let agentStopped = false
  if (taskCount > 0) {
    const proj = await ensureAgentProject(admin, { projectId, actorUserId: args.actorUserId })
    if (!proj.ok) return { ok: false, error: proj.error }
    agentStopped = proj.stopped
  }
  const result = await runWbsImport(admin, args)
  if (!result.ok) return { ok: false, error: result.message }

  revalidatePath(`/p/${projectId}/wbs`)
  return {
    ok: true, upserted: result.upserted, ordersCreated: result.ordersCreated, unmatched: result.unmatched,
    taskCount, ...(agentStopped ? { agentStopped: true } : {}),
    ...(result.delegationCancelled > 0 ? { delegationCancelled: result.delegationCancelled } : {}),
    ...(result.delegationCancelFailed.length > 0 ? { delegationCancelFailed: result.delegationCancelFailed } : {}),
  }
}

export async function applyWbsUpload(projectId: string, md: string, opts?: WbsUploadOptions): Promise<WbsUploadApplyResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  try {
    if (detectWbsFormat(md) === 'classic') {
      // module 은 적용 시점에 다시 제안하지 않는다 — 미리보기와 적용 사이에 제안이 바뀌면 다른 이름공간에
      // 중복 트리가 조용히 생긴다. 사람이 미리보기에서 확인한 값만 받는다.
      const module_ = typeof opts?.module === 'string' ? opts.module.trim() : ''
      if (!module_) return { ok: false, error: 'module 이 필요합니다 — 기존 형식 파일은 module 을 지정해야 올릴 수 있습니다.' }
      if (!MODULE_RE.test(module_)) return { ok: false, error: 'module 형식이 올바르지 않습니다.' }
      const nodes = parseClassicWbs(md)
      const admin = createAdminClient()
      // 클라이언트 미리보기를 신뢰하지 않는다 — 서버 측 전체 재검증(fail-closed).
      const c = checkClassic(nodes, module_, await readProjectRefs(admin, projectId))
      if (c.errors.length > 0) return { ok: false, error: `검증 실패 ${c.errors.length}건: ${c.errors.slice(0, 3).join(' / ')}` }
      // levels·attach 없음 = API 라우트가 levels 없이 호출할 때(route.ts levels=null)와 같은 경로.
      return await runImportAndReport(admin, {
        projectId, module: module_, actorUserId: g.actor.userId, levels: null, attachRef: null, nodes,
      })
    }

    // 클라이언트 미리보기를 신뢰하지 않는다 — 전 과정 재검증(fail-closed).
    const { doc, role, errors } = parseAndValidate(md)
    if (errors.length > 0) return { ok: false, error: `검증 실패 ${errors.length}건: ${errors.slice(0, 3).join(' / ')}` }
    const module_ = doc.front.module ?? ''
    if (!MODULE_RE.test(module_)) return { ok: false, error: 'module 형식이 올바르지 않습니다.' }

    const admin = createAdminClient()
    let attachRef: string | null = null
    if (role === 'pl' && doc.front.attach) {
      const r = await resolveAttachRef(admin, projectId, doc.front.attach)
      if (!r.ref) {
        return { ok: false, error: r.ambiguous
          ? `attach 부착점이 모호합니다: ${doc.front.attach}`
          : `attach 노드가 서버에 없습니다: ${doc.front.attach} — 골격을 먼저 업로드하세요.` }
      }
      attachRef = r.ref
    }

    return await runImportAndReport(admin, {
      projectId, module: module_, actorUserId: g.actor.userId,
      levels: doc.levels, attachRef, nodes: toImportNodes(doc),
    })
  } catch (e) {
    console.error('[wbs-md] 적용 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: e instanceof Error ? e.message : '업로드에 실패했습니다.' }
  }
}
