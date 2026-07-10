'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { mondayIso } from '@/lib/report/week'
import { carryOverRows, isWeeklyCellKey } from '@/lib/domain/weeklySheet'
import { findCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'

export interface WeeklyActionResult { ok: boolean; error?: string }

const CELL_MAX = 20000        // 공지 body와 동일 상한
const NAME_MAX = 100          // 구분·모듈명 상한

function revalidateWeekly(projectId: string) {
  revalidatePath(`/p/${projectId}/weekly`)
}

/** 주차 문서 생성. carryOver=true면 이월 원본(가장 최근 이전 주차)에서 행 구성+차주계획을 초안으로. */
export async function createWeeklyReport(
  projectId: string, weekStartIso: string, carryOver: boolean,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const weekStart = mondayIso(weekStartIso)

  // 이미 있으면 멱등 성공(동시 생성 경쟁 대비)
  if (await getWeeklySheet(projectId, weekStart)) return { ok: true }

  const sb = await createServerClient()
  const { data: report, error } = await sb.from('weekly_reports')
    .insert({ project_id: projectId, week_start: weekStart })
    .select('id').single()
  if (error) {
    if (error.code === '23505') { revalidateWeekly(projectId); return { ok: true } } // 동시 생성 — 승자 문서 사용
    return { ok: false, error: error.message }
  }

  if (carryOver) {
    const src = await findCarryOverSource(projectId, weekStart)
    if (src && src.rows.length) {
      const rows = carryOverRows(src.rows).map(r => ({
        report_id: report.id as string, section: r.section, module: r.module, sort_order: r.sortOrder,
        this_content: r.thisContent, this_issue: r.thisIssue,
        next_content: r.nextContent, next_issue: r.nextIssue,
      }))
      const { error: rowErr } = await sb.from('weekly_report_rows').insert(rows)
      if (rowErr) return { ok: false, error: rowErr.message }
    }
  }
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
  const { error } = await sb.from('weekly_report_rows')
    .update({ [cellKey]: content, updated_at: new Date().toISOString() }) // updated_at 트리거 없음 — 수동(wbs.ts 관례)
    .eq('id', rowId)
  if (error) return { ok: false, error: error.message }
  // revalidate 불필요 — 셀 값은 클라이언트 상태 + Realtime으로 동기화(새로고침 시 서버 조회가 최신)
  return { ok: true }
}

export async function addWeeklyRow(
  projectId: string, reportId: string, section: string, module: string,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sec = section.trim(), mod = module.trim()
  if (!mod) return { ok: false, error: '모듈명을 입력하세요.' }
  if (sec.length > NAME_MAX || mod.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const { data: last } = await sb.from('weekly_report_rows').select('sort_order')
    .eq('report_id', reportId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { error } = await sb.from('weekly_report_rows')
    .insert({ report_id: reportId, section: sec, module: mod, sort_order: ((last?.sort_order as number) ?? 0) + 1 })
  if (error) return { ok: false, error: error.message }
  revalidateWeekly(projectId)
  return { ok: true }
}

export async function deleteWeeklyRow(projectId: string, rowId: string): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { error } = await sb.from('weekly_report_rows').delete().eq('id', rowId)
  if (error) return { ok: false, error: error.message }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 행 이동 — 동일 section 내 인접 행과 swap(스펙 §3: 구분 병합이 갈라지지 않게). */
export async function moveWeeklyRow(
  projectId: string, rowId: string, dir: 'up' | 'down',
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: me } = await sb.from('weekly_report_rows')
    .select('id, report_id, section, sort_order').eq('id', rowId).maybeSingle()
  if (!me) return { ok: false, error: '행을 찾을 수 없습니다.' }

  const { data: all } = await sb.from('weekly_report_rows')
    .select('id, section, sort_order').eq('report_id', me.report_id as string).order('sort_order')
  const list = all ?? []
  const idx = list.findIndex(r => r.id === rowId)
  const nIdx = dir === 'up' ? idx - 1 : idx + 1
  const neighbor = list[nIdx]
  if (!neighbor || neighbor.section !== me.section) return { ok: false, error: '같은 구분 안에서만 이동할 수 있습니다.' }

  const [r1, r2] = await Promise.all([
    sb.from('weekly_report_rows').update({ sort_order: neighbor.sort_order as number }).eq('id', rowId),
    sb.from('weekly_report_rows').update({ sort_order: me.sort_order as number }).eq('id', neighbor.id as string),
  ])
  const err = r1.error ?? r2.error
  if (err) return { ok: false, error: err.message }
  revalidateWeekly(projectId)
  return { ok: true }
}
