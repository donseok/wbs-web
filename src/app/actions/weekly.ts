'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { mondayIso } from '@/lib/report/week'
import { carryOverRows, defaultWeeklyRows, isWeeklyCellKey, type NewWeeklyRow } from '@/lib/domain/weeklySheet'
import { findCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'

export interface WeeklyActionResult { ok: boolean; error?: string }

const CELL_MAX = 20000        // 공지 body와 동일 상한
const NAME_MAX = 100          // 구분·모듈명 상한
const TITLE_MAX = 200         // 시트 제목 상한
const RENAME_MAX_ROWS = 50    // 그룹 rename 대상 행 수 상한(병합 그룹 크기 방어)

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

  // 이월이면 이월 원본 행, 아니면 표준 스켈레톤 12행(레퍼런스 프레임) — 행 0개 문서는 만들지 않는다.
  let seed: NewWeeklyRow[] = []
  if (carryOver) {
    const src = await findCarryOverSource(projectId, weekStart)
    if (src && src.rows.length) seed = carryOverRows(src.rows)
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
    await sb.from('weekly_reports').delete().eq('id', report.id)
    return { ok: false, error: rowErr.message }
  }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 병합 그룹(연속 동일 구분) 전체의 구분명을 바꾼다 — 콤보박스 선택 경로. */
export async function renameWeeklySection(
  projectId: string, rowIds: string[], section: string,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const sec = section.trim()
  if (!sec) return { ok: false, error: '구분명을 입력하세요.' }
  if (sec.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이하여야 합니다.` }
  if (!rowIds.length || rowIds.length > RENAME_MAX_ROWS) return { ok: false, error: '잘못된 대상입니다.' }

  const sb = await createServerClient()
  const { error } = await sb.from('weekly_report_rows')
    .update({ section: sec, updated_at: new Date().toISOString() }).in('id', rowIds)
  if (error) return { ok: false, error: error.message }
  revalidateWeekly(projectId)
  return { ok: true }
}

/** 행 하나의 모듈명을 바꾼다 — 콤보박스 선택 경로. */
export async function renameWeeklyModule(
  projectId: string, rowId: string, module: string,
): Promise<WeeklyActionResult> {
  if (!(await getSession())) return { ok: false, error: '로그인 필요' }
  const mod = module.trim()
  if (!mod) return { ok: false, error: '모듈명을 입력하세요.' }
  if (mod.length > NAME_MAX) return { ok: false, error: `이름은 ${NAME_MAX}자 이하여야 합니다.` }

  const sb = await createServerClient()
  const { error } = await sb.from('weekly_report_rows')
    .update({ module: mod, updated_at: new Date().toISOString() }).eq('id', rowId)
  if (error) return { ok: false, error: error.message }
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
  if (!data || data.length === 0) return { ok: false, error: '행이 삭제되어 저장할 수 없습니다.' }
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
  const { data: all } = await sb.from('weekly_report_rows').select('id, section, sort_order')
    .eq('report_id', reportId).order('sort_order')
  const rows = all ?? []

  // section 연속성 유지(스펙 §3 rowSpan 병합) — 같은 section이 이미 있으면 그 section의
  // 마지막 행 바로 뒤에 삽입한다. 문서 맨 끝(전체 max+1)에 붙이면 다른 section 뒤에 고립되고,
  // moveWeeklyRow는 동일 section 인접 swap만 허용하므로 UI로 복구할 수 없다.
  const sameSection = rows.filter(r => (r.section as string).trim() === sec)
  let newSort: number
  if (sameSection.length) {
    newSort = (sameSection[sameSection.length - 1].sort_order as number) + 1
    // newSort 이상인 기존 행을 한 칸씩 뒤로 민다. sort_order에 unique 제약이 없어 순서는 자유이나,
    // 내림차순으로 순차 처리(첫 에러에서 중단 — 부분 shift 잔류는 moveWeeklyRow와 동일한 비원자성 한계로 수용).
    const toShift = rows.filter(r => (r.sort_order as number) >= newSort)
      .sort((a, b) => (b.sort_order as number) - (a.sort_order as number))
    for (const r of toShift) {
      const { error: shiftErr } = await sb.from('weekly_report_rows')
        .update({ sort_order: (r.sort_order as number) + 1 }).eq('id', r.id as string)
      if (shiftErr) return { ok: false, error: shiftErr.message }
    }
  } else {
    newSort = rows.length ? (rows[rows.length - 1].sort_order as number) + 1 : 1
  }

  const { error } = await sb.from('weekly_report_rows')
    .insert({ report_id: reportId, section: sec, module: mod, sort_order: newSort })
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
