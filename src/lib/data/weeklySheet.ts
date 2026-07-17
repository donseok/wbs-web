import { createServerClient } from '@/lib/supabase/server'
import { WEEKLY_SECTIONS, type WeeklySheetRow } from '@/lib/domain/weeklySheet'

export interface WeeklyReportDoc { id: string; projectId: string; weekStart: string; title: string }

type RowRecord = {
  id: string; report_id: string; section: string; module: string; sort_order: number
  this_content: string; this_issue: string; next_content: string; next_issue: string
}

function mapRow(r: RowRecord): WeeklySheetRow {
  return {
    id: r.id, reportId: r.report_id, section: r.section, module: r.module, sortOrder: r.sort_order,
    thisContent: r.this_content, thisIssue: r.this_issue,
    nextContent: r.next_content, nextIssue: r.next_issue,
  }
}

const ROW_COLS = 'id, report_id, section, module, sort_order, this_content, this_issue, next_content, next_issue'

/** reportId의 시트 행 전부(sort_order 순). 양식 통일 미리보기 등 저장 상태 기준 검사가 공유. */
export async function loadWeeklyRows(reportId: string): Promise<WeeklySheetRow[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_report_rows').select(ROW_COLS)
    .eq('report_id', reportId).order('sort_order')
  if (error) throw new Error(error.message) // 조회 실패를 '행 없음'으로 위장하면 이월이 스켈레톤으로 대체돼 내용이 유실됨
  return ((data ?? []) as RowRecord[]).map(mapRow)
}

/** 지연 마이그레이션: WEEKLY_SECTIONS에 구분이 추가돼도(예: PMO) 과거 주차 시트에 그 구분 행이 없어
 *  그리드에서 안 보이는 문제를 막는다. 표준 구분 중 빠진 것만 **빈 행으로 추가**한다 —
 *  기존 행·내용은 절대 건드리지 않는(순수 추가) 안전한 연산. sort_order는 WEEKLY_SECTIONS 순서를
 *  반영하는 음수를 부여해 기존 양수 행보다 앞서게 한다(PMO가 영업 위에 오도록).
 *  드물게 두 요청이 동시에 백필하면 같은 구분 행이 둘 생길 수 있으나, 그리드·PPT·이월이 모두
 *  같은 구분 다중 행을 흡수하도록 설계돼 있어 무해하고 이월 시 한 행으로 합쳐진다. */
async function ensureStandardRows(reportId: string, rows: WeeklySheetRow[]): Promise<WeeklySheetRow[]> {
  const present = new Set(rows.map(r => r.section.trim()))
  // 레거시 시트(구 공통/ERP/MES 구조 — 표준 구분이 하나도 없음)는 백필 대상이 아니다.
  // 표준 구분이 하나라도 있는 '신규 체계' 시트만 새로 추가된 표준 구분(PMO 등)을 채운다.
  // 이 가드가 없으면 레거시 시트에 표준 10행이 통째로 추가돼 그리드가 어지러워진다(PPT는 rows와 무관하게 전 구분 합성).
  if (!WEEKLY_SECTIONS.some(s => present.has(s))) return rows
  const missing = WEEKLY_SECTIONS.filter(s => !present.has(s))
  if (!missing.length) return rows
  const sb = await createServerClient()
  const toInsert = missing.map(section => ({
    report_id: reportId, section, module: '',
    sort_order: WEEKLY_SECTIONS.indexOf(section) - WEEKLY_SECTIONS.length, // 음수 → 기존 행보다 앞, 서로는 구분 순서 유지
    this_content: '', this_issue: '', next_content: '', next_issue: '',
  }))
  const { data, error } = await sb.from('weekly_report_rows').insert(toInsert).select(ROW_COLS)
  if (error) {
    // 백필 실패가 시트 조회 자체를 막지 않게 — 기존 행만이라도 반환한다(그리드는 계속 동작). PPT는 rows와 무관하게 전 구분을 합성.
    console.error('[ensureStandardRows] 표준 구분 백필 실패:', error.message)
    return rows
  }
  return [...rows, ...((data ?? []) as RowRecord[]).map(mapRow)].sort((a, b) => a.sortOrder - b.sortOrder)
}

/** 해당 주차 문서+행. 없으면 null(문서는 자동 생성하지 않음 — 스펙 §3).
 *  문서가 있으면 표준 구분 중 빠진 행만 빈 값으로 백필해(ensureStandardRows) WEEKLY_SECTIONS와
 *  정합을 맞춘다 — 새 구분(PMO)이 과거 시트에서도 그리드에 나타나게 한다. */
export async function getWeeklySheet(
  projectId: string, weekStartIso: string,
): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_reports').select('id, project_id, week_start, title')
    .eq('project_id', projectId).eq('week_start', weekStartIso).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const report = {
    id: data.id as string, projectId: data.project_id as string,
    weekStart: data.week_start as string, title: (data.title as string | null) ?? '',
  }
  return { report, rows: await ensureStandardRows(report.id, await loadWeeklyRows(report.id)) }
}

/** 이월 원본: 해당 주 이전 가장 최근 week_start 문서(직전 주 한정 아님 — 연휴 건너뜀 대응, 스펙 §4). */
export async function findCarryOverSource(
  projectId: string, beforeWeekStartIso: string,
): Promise<{ report: WeeklyReportDoc; rows: WeeklySheetRow[] } | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_reports').select('id, project_id, week_start, title')
    .eq('project_id', projectId).lt('week_start', beforeWeekStartIso)
    .order('week_start', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message) // null(원본 없음)과 조회 실패를 구분 — 실패 시 이월 폴백 금지
  if (!data) return null
  const report = {
    id: data.id as string, projectId: data.project_id as string,
    weekStart: data.week_start as string, title: (data.title as string | null) ?? '',
  }
  return { report, rows: await loadWeeklyRows(report.id) }
}
