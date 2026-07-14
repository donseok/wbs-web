'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { mondayIso } from '@/lib/report/week'
import { carryOverRows, defaultWeeklyRows, isWeeklyCellKey, type NewWeeklyRow, type WeeklyCellEdit } from '@/lib/domain/weeklySheet'
import { findCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'

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

const CELL_MAX = 20000        // 공지 body와 동일 상한
const BATCH_MAX = 500         // 한 배치의 최대 edit 수(페이로드 크기 방어)
const TITLE_MAX = 200         // 시트 제목 상한

function revalidateWeekly(projectId: string) {
  revalidatePath(`/p/${projectId}/weekly`)
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 보상 삭제 — 행이 하나도 없을 때만. 그 사이 다른 사용자가 넣은 행을 cascade로 지우지 않게. */
async function deleteReportIfEmpty(
  sb: Awaited<ReturnType<typeof createServerClient>>, reportId: string,
): Promise<void> {
  const { data } = await sb.from('weekly_report_rows').select('id').eq('report_id', reportId).limit(1)
  if (!data || data.length === 0) await sb.from('weekly_reports').delete().eq('id', reportId)
}

/** 주차 문서 생성. carryOver=true면 이월 원본(가장 최근 이전 주차)에서 행 구성+차주계획을 초안으로. */
export async function createWeeklyReport(
  projectId: string, weekStartIso: string, carryOver: boolean,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
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

  // 이월이면 이월 원본 행(신규 구분으로 정규화된 10행), 아니면 표준 스켈레톤 10행 — 행 0개 문서는 만들지 않는다.
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
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const t = title.trim()
  if (t.length > TITLE_MAX) return { ok: false, error: `제목은 ${TITLE_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const { error } = await sb.from('weekly_reports')
    .update({ title: t, updated_at: new Date().toISOString() }).eq('id', reportId)
  if (error) return { ok: false, error: error.message }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 셀 저장 — 열 화이트리스트 강제(last-write-wins, 스펙 §2). */
export async function saveWeeklyCell(
  projectId: string, rowId: string, cellKey: string, content: string,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  if (!isWeeklyCellKey(cellKey)) return { ok: false, error: '잘못된 셀입니다.' }
  if (content.length > CELL_MAX) return { ok: false, error: `내용은 ${CELL_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
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
  projectId: string,          // 시그니처 대칭·향후 로깅용(saveWeeklyCell 관례). update 쿼리에는 미사용
  edits: WeeklyCellEdit[],
): Promise<WeeklyBatchResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
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
  const goneRowIds: string[] = []
  for (const e of deduped.values()) {
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
