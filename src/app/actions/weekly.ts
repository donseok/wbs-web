'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { mondayIso } from '@/lib/report/week'
import {
  carryOverRows, defaultWeeklyRows, isWeeklyCellKey, rowSectionLabel, WEEKLY_CELL_LABEL, WEEKLY_CELL_MAX,
  type NewWeeklyRow, type WeeklyCellEdit, type WeeklyCellKey,
} from '@/lib/domain/weeklySheet'
import { findCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'
import { generateAnswer } from '@/lib/ai/llm'
import { hasLLM } from '@/lib/ai/provider'
import {
  buildWeeklyRewritePrompt, parseWeeklyRewriteResponse, WEEKLY_REWRITE_MAX_CELLS,
  WEEKLY_REWRITE_MAX_TOTAL_CHARS, WEEKLY_REWRITE_SYSTEM_PROMPT,
} from '@/lib/ai/weekly-rewrite'

export interface WeeklyActionResult {
  ok: boolean
  error?: string
  gone?: boolean // 대상 행이 이미 삭제됨 — 재시도 무의미(클라이언트가 dirty 정리·행 제거)
}

// 배치는 단건과 시맨틱이 반대다 — 일부 행이 사라져도 살아있는 행 저장은 성공(ok:true).
// 그래서 단건 `gone:boolean`(저장 실패)과 혼동되지 않게 `goneRowIds:string[]`로 분리한다.
export interface WeeklyBatchResult {
  ok: boolean
  error?: string          // ok:false일 때만. 사람이 읽는 설명
  goneRowIds?: string[]   // ok:true여도 존재 가능 — 저장 시점 이미 삭제된 행(스킵됨). FE가 그 행만 정리
}

export interface WeeklyRewriteInput {
  rowId: string
  cellKey: WeeklyCellKey
  content: string
}

export interface WeeklyRewriteSuggestion extends WeeklyRewriteInput {
  original: string
}

export type WeeklyRewriteResult =
  | { ok: true; edits: WeeklyRewriteSuggestion[] }
  | { ok: false; error: string }

const CELL_MAX = WEEKLY_CELL_MAX // 셀 1개 상한(도메인 단일 출처) — 이월 병합 클램프와 동일 값
const BATCH_MAX = 500         // 한 배치의 최대 edit 수(페이로드 크기 방어)
const TITLE_MAX = 200         // 시트 제목 상한
const WEEKLY_REWRITE_COOLDOWN_MS = 3_000 // Gemini 무료 RPM 보호 — 사용자·프로젝트별 호출 하한
const WEEKLY_REWRITE_GATE_MAX = 500
const weeklyRewriteInFlight = new Map<string, Promise<string | null>>()
const weeklyRewriteLastAttempt = new Map<string, number>()

function rememberWeeklyRewriteAttempt(key: string, now: number) {
  if (!weeklyRewriteLastAttempt.has(key) && weeklyRewriteLastAttempt.size >= WEEKLY_REWRITE_GATE_MAX) {
    const oldest = weeklyRewriteLastAttempt.keys().next().value as string | undefined
    if (oldest) weeklyRewriteLastAttempt.delete(oldest)
  }
  // 기존 키도 맨 뒤로 옮겨 오래 활동하지 않은 사용자부터 제거되게 한다.
  weeklyRewriteLastAttempt.delete(key)
  weeklyRewriteLastAttempt.set(key, now)
}

function revalidateWeekly(projectId: string) {
  revalidatePath(`/p/${projectId}/weekly`)
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 보상 삭제 — 행이 하나도 없을 때만. 그 사이 다른 사용자가 넣은 행을 cascade로 지우지 않게. */
async function deleteReportIfEmpty(
  sb: Awaited<ReturnType<typeof createServerClient>>, reportId: string,
): Promise<void> {
  const { data, error } = await sb.from('weekly_report_rows').select('id').eq('report_id', reportId).limit(1)
  // 조회 실패를 '행 0개'로 오인해 삭제하면 그새 다른 사용자가 넣은 행까지 cascade 로 사라진다(복구 불가).
  // 보상 삭제는 어차피 최선 노력이므로, 실패하면 지우지 않고 빈 문서를 남긴 채 로그만 남긴다.
  if (error) {
    console.error('[deleteReportIfEmpty] 행 존재 확인 실패 — 보상 삭제를 건너뜁니다:', error.message)
    return
  }
  if (data && data.length === 0) {
    const { error: delErr } = await sb.from('weekly_reports').delete().eq('id', reportId)
    if (delErr) console.error('[deleteReportIfEmpty] 보상 삭제 실패:', delErr.message)
  }
}

/** 주차 문서 생성. carryOver=true면 이월 원본(가장 최근 이전 주차)에서 행 구성+차주계획을 초안으로. */
export async function createWeeklyReport(
  projectId: string, weekStartIso: string, carryOver: boolean,
): Promise<WeeklyActionResult> {
  // 회차(주차 문서) 생성은 시트의 구조를 만드는 일이라 관리자 몫 — 셀 편집(멤버)과 급이 다르다.
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const weekStart = mondayIso(weekStartIso)

  // 이미 있으면 멱등 성공(동시 생성 경쟁 대비). 조회 실패는 throw로 오므로 정직하게 중단.
  try {
    if (await getWeeklySheet(projectId, weekStart)) return { ok: true }
  } catch (e) {
    return { ok: false, error: `주차 문서 확인에 실패했습니다: ${errMsg(e)}` }
  }

  const sb = await createServerClient()
  const { data: report, error } = await sb.from('weekly_reports')
    .insert({ project_id: projectId, week_start: weekStart })
    .select('id').single()
  if (error) {
    if (error.code === '23505') { revalidateWeekly(projectId); return { ok: true } } // 동시 생성 — 승자 문서 사용
    return { ok: false, error: error.message }
  }

  // 이월이면 이월 원본 행(신규 구분으로 정규화된 11행), 아니면 표준 스켈레톤 11행 — 행 0개 문서는 만들지 않는다.
  // 이월 원본 '조회 실패'는 '원본 없음'과 구분해 중단한다 — 스켈레톤으로 대체 생성되면 문서가
  // 멱등 체크에 걸려 재시도가 불가능해지고 이월 초안이 조용히 유실되기 때문.
  let seed: NewWeeklyRow[] = []
  if (carryOver) {
    try {
      const src = await findCarryOverSource(projectId, weekStart)
      if (src && src.rows.length) seed = carryOverRows(src.rows)
    } catch (e) {
      await deleteReportIfEmpty(sb, report.id as string)
      return { ok: false, error: `이월 원본을 불러오지 못했습니다: ${errMsg(e)}` }
    }
  }
  if (!seed.length) seed = defaultWeeklyRows()

  const rows = seed.map(r => ({
    report_id: report.id as string, section: r.section, module: r.module, sort_order: r.sortOrder,
    this_content: r.thisContent, this_issue: r.thisIssue,
    next_content: r.nextContent, next_issue: r.nextIssue,
  }))
  const { error: rowErr } = await sb.from('weekly_report_rows').insert(rows)
  if (rowErr) {
    // 보상 삭제 — 빈 report만 남으면 멱등 체크에 걸려 재시도해도 시드가 영영 안 됨. 삭제 실패는 최선 노력으로 무시.
    await deleteReportIfEmpty(sb, report.id as string)
    return { ok: false, error: rowErr.message }
  }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 시트 제목 저장 — ''이면 화면이 기본 제목(프로젝트명+주차)을 합성한다. */
export async function saveWeeklyTitle(
  projectId: string, reportId: string, title: string,
): Promise<WeeklyActionResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const t = title.trim()
  if (t.length > TITLE_MAX) return { ok: false, error: `제목은 ${TITLE_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  // 대상 회차가 판정 기준 프로젝트의 것인지 쿼리에 못 박는다 — 인자 projectId 로만 판정하고
  // 미결합 reportId 로 쓰면, A 의 멤버가 B 의 회차 제목을 고칠 수 있다(0053 이전에는 RLS 도
  // using(true) 라 2차 방어선이 없었다). 0행이면 대상이 없거나 남의 프로젝트다.
  const { data, error } = await sb.from('weekly_reports')
    .update({ title: t, updated_at: new Date().toISOString() })
    .eq('id', reportId).eq('project_id', projectId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '대상 회차를 찾을 수 없습니다.' }
  revalidateWeekly(projectId)
  return { ok: true }
}

/**
 * 주어진 행들이 **이 프로젝트의 회차** 소속인지 한 번에 확인한다.
 * 셀 저장은 rowId 만 받으므로, 이 결합이 없으면 인자 projectId 로 가드를 통과한 뒤
 * 남의 프로젝트 행을 쓸 수 있다. 조회 실패는 쓰기 중단 사유다(3원칙 ②).
 */
async function rowsInProject(
  sb: Awaited<ReturnType<typeof createServerClient>>, projectId: string, rowIds: string[],
): Promise<{ ok: true; allowed: Set<string> } | { ok: false; error: string }> {
  const { data, error } = await sb.from('weekly_report_rows')
    .select('id, weekly_reports!inner(project_id)')
    .in('id', rowIds)
    .eq('weekly_reports.project_id', projectId)
  if (error) {
    console.error('[weekly] 대상 행 소속 확인 실패:', error.message)
    return { ok: false, error: '대상을 확인할 수 없어 저장을 중단했습니다.' }
  }
  return { ok: true, allowed: new Set((data ?? []).map(r => r.id as string)) }
}

/**
 * 선택한 주간업무 셀을 AI가 다듬은 **미리보기**만 만든다.
 * 현재 로컬 입력(자동 저장 전 값 포함)은 클라이언트가 보내고, DB 조회는 프로젝트 소속 확인과
 * 구분 라벨에만 쓴다. 이 액션에서는 어떤 셀도 저장하지 않는다.
 */
export async function prepareWeeklyCellRewrite(
  projectId: string,
  inputs: WeeklyRewriteInput[],
): Promise<WeeklyRewriteResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!Array.isArray(inputs) || inputs.length === 0)
    return { ok: false, error: '다듬을 내용이 없습니다.' }
  if (inputs.length > WEEKLY_REWRITE_MAX_CELLS)
    return { ok: false, error: `한 번에 최대 ${WEEKLY_REWRITE_MAX_CELLS}개 셀까지 다듬을 수 있습니다.` }

  const addresses = new Set<string>()
  let totalChars = 0
  for (const input of inputs) {
    if (!input || typeof input.rowId !== 'string' || !input.rowId)
      return { ok: false, error: '잘못된 대상이 포함되어 있습니다.' }
    if (!isWeeklyCellKey(input.cellKey))
      return { ok: false, error: '잘못된 셀이 포함되어 있습니다.' }
    if (typeof input.content !== 'string' || !input.content.trim())
      return { ok: false, error: '빈 셀은 AI로 다듬을 수 없습니다.' }
    if (input.content.length > CELL_MAX)
      return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }
    const address = `${input.rowId}:${input.cellKey}`
    if (addresses.has(address))
      return { ok: false, error: '같은 셀이 중복으로 선택되었습니다.' }
    addresses.add(address)
    totalChars += input.content.length
  }
  if (totalChars > WEEKLY_REWRITE_MAX_TOTAL_CHARS)
    return { ok: false, error: '선택한 내용이 너무 깁니다. 범위를 나눠 다시 시도해 주세요.' }

  const sb = await createServerClient()
  const rowIds = [...new Set(inputs.map(input => input.rowId))]
  const scope = await rowsInProject(sb, projectId, rowIds)
  if (!scope.ok) return { ok: false, error: scope.error }
  if (rowIds.some(rowId => !scope.allowed.has(rowId)))
    return { ok: false, error: '선택한 셀을 확인할 수 없습니다.' }
  if (!hasLLM())
    return { ok: false, error: 'AI 모델이 설정되어 있지 않습니다. 관리자에게 AI 설정을 요청해 주세요.' }

  const { data: labelRows, error: labelError } = await sb.from('weekly_report_rows')
    .select('id, section, module')
    .in('id', rowIds)
  if (labelError || !labelRows || labelRows.length !== rowIds.length) {
    if (labelError) console.error('[weekly] AI 재작성 대상 라벨 조회 실패:', labelError.message)
    return { ok: false, error: '선택한 셀을 확인할 수 없습니다.' }
  }

  const labels = new Map(labelRows.map(row => [
    row.id as string,
    rowSectionLabel({ section: String(row.section ?? ''), module: String(row.module ?? '') }),
  ]))
  const promptCells = inputs.map((input, index) => ({
    id: `c${index}`,
    section: labels.get(input.rowId) ?? '기타',
    field: WEEKLY_CELL_LABEL[input.cellKey],
    content: input.content,
  }))
  const prompt = buildWeeklyRewritePrompt(promptCells)
  const gateKey = `${g.actor.userId}:${projectId}`
  const exactRequestKey = `${gateKey}:${prompt}`
  let raw: string | null
  const running = weeklyRewriteInFlight.get(exactRequestKey)
  if (running) {
    raw = await running
  } else {
    const now = Date.now()
    if (now - (weeklyRewriteLastAttempt.get(gateKey) ?? 0) < WEEKLY_REWRITE_COOLDOWN_MS)
      return { ok: false, error: 'AI 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.' }
    rememberWeeklyRewriteAttempt(gateKey, now)
    const pending = generateAnswer(
      WEEKLY_REWRITE_SYSTEM_PROMPT,
      [{ role: 'user', content: prompt }],
      {
        timeoutMs: 15_000,
        maxOutputTokens: 8_192,
        allowModelFallback: false,
        retries: 0,
        retryRateLimit: false,
      },
    )
    weeklyRewriteInFlight.set(exactRequestKey, pending)
    try {
      raw = await pending
    } finally {
      if (weeklyRewriteInFlight.get(exactRequestKey) === pending)
        weeklyRewriteInFlight.delete(exactRequestKey)
    }
  }
  if (!raw)
    return { ok: false, error: 'AI가 내용을 다듬지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  const rewritten = parseWeeklyRewriteResponse(raw, promptCells)
  if (!rewritten)
    return { ok: false, error: 'AI 응답을 확인하지 못했습니다. 원문은 변경되지 않았습니다.' }

  return {
    ok: true,
    edits: inputs.map((input, index) => ({
      rowId: input.rowId,
      cellKey: input.cellKey,
      original: input.content,
      content: rewritten[index].content,
    })),
  }
}

/** 셀 저장 — 열 화이트리스트 강제(last-write-wins, 스펙 §2). */
export async function saveWeeklyCell(
  projectId: string, rowId: string, cellKey: string, content: string,
): Promise<WeeklyActionResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isWeeklyCellKey(cellKey)) return { ok: false, error: '잘못된 셀입니다.' }
  if (content.length > CELL_MAX) return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const scope = await rowsInProject(sb, projectId, [rowId])
  if (!scope.ok) return { ok: false, error: scope.error }
  // 소속이 아니면 '행 없음'과 같은 취급 — 남의 프로젝트 행의 존재를 알려 주지 않는다.
  if (!scope.allowed.has(rowId)) return { ok: false, error: '행이 삭제되어 저장할 수 없습니다.', gone: true }
  const { data, error } = await sb.from('weekly_report_rows')
    .update({ [cellKey]: content, updated_at: new Date().toISOString() }) // updated_at 트리거 없음 — 수동(wbs.ts 관례)
    .eq('id', rowId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '행이 삭제되어 저장할 수 없습니다.', gone: true }
  // revalidate 불필요 — 셀 값은 클라이언트 상태 + Realtime으로 동기화(새로고침 시 서버 조회가 최신)
  return { ok: true }
}

/**
 * 멀티셀 배치 저장(붙여넣기/범위삭제/채우기/undo) — last-write-wins, no-revalidate.
 * 살아있는 행 저장은 성공하고 삭제된 행만 goneRowIds로 스킵한다(부분 실패 시맨틱, AC8.4).
 * 배치는 멱등(같은 배치 통째 재시도 안전) — DB 에러 시 즉시 중단하되 롤백은 하지 않는다.
 */
export async function saveWeeklyCells(
  projectId: string,          // 권한 판정 기준·시그니처 대칭용(saveWeeklyCell 관례). update 쿼리에는 미사용
  edits: WeeklyCellEdit[],
): Promise<WeeklyBatchResult> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (edits.length === 0) return { ok: true }                                             // no-op — DB 접근 없음
  if (edits.length > BATCH_MAX) return { ok: false, error: '한 번에 저장할 수 있는 셀 수를 초과했습니다.' } // dedupe 전 원본 길이 기준
  for (const e of edits) {
    if (!isWeeklyCellKey(e.cellKey)) return { ok: false, error: '잘못된 셀입니다.' }        // 구조 필드 차단(D1)
    if (e.content.length > CELL_MAX) return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }
    if (!e.rowId) return { ok: false, error: '잘못된 대상입니다.' }
  }

  // 방어적 dedupe — 같은 `${rowId}:${cellKey}`는 마지막이 이겨(last-wins) 적용값을 결정적으로.
  const deduped = new Map<string, WeeklyCellEdit>()
  for (const e of edits) deduped.set(`${e.rowId}:${e.cellKey}`, e)

  const sb = await createServerClient()
  // 배치 전체의 소속을 한 번에 확인한다(건별 왕복 회피). 소속 아닌 행은 삭제된 행과
  // 같은 취급으로 goneRowIds 에 넣어 스킵 — 부분 실패 시맨틱을 유지한다.
  const scope = await rowsInProject(sb, projectId, [...new Set([...deduped.values()].map(e => e.rowId))])
  if (!scope.ok) return { ok: false, error: scope.error }
  const goneRowIds: string[] = []
  for (const e of deduped.values()) {
    if (!scope.allowed.has(e.rowId)) {
      if (!goneRowIds.includes(e.rowId)) goneRowIds.push(e.rowId)
      continue
    }
    const { data, error } = await sb.from('weekly_report_rows')
      .update({ [e.cellKey]: e.content, updated_at: new Date().toISOString() }) // updated_at 수동 갱신(트리거 없음, wbs.ts 관례)
      .eq('id', e.rowId)
      .select('id')
    if (error) return { ok: false, error: error.message }        // 진성 DB 에러 — 즉시 중단(비원자적, 재시도는 멱등)
    if (!data || data.length === 0) goneRowIds.push(e.rowId)     // 0행 영향(삭제된 행) — 스킵하고 계속(전체 실패 아님)
  }
  // revalidate 안 함 — 각 update가 개별 Realtime 이벤트를 발생시켜 타 세션에 전파(saveWeeklyCell과 동일)
  return goneRowIds.length ? { ok: true, goneRowIds } : { ok: true }
}
