import { createServerClient } from '@/lib/supabase/server'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

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

async function loadRows(reportId: string): Promise<WeeklySheetRow[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('weekly_report_rows').select(ROW_COLS)
    .eq('report_id', reportId).order('sort_order')
  if (error) throw new Error(error.message) // 조회 실패를 '행 없음'으로 위장하면 이월이 스켈레톤으로 대체돼 내용이 유실됨
  return ((data ?? []) as RowRecord[]).map(mapRow)
}

/** 해당 주차 문서+행. 없으면 null(자동 생성하지 않음 — 스펙 §3). */
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
  return { report, rows: await loadRows(report.id) }
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
  return { report, rows: await loadRows(report.id) }
}
