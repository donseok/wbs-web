import { createServerClient } from '@/lib/supabase/server'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import type { SnapshotPoint } from '@/lib/domain/trend'
import type { WbsRow } from '@/lib/domain/types'

type Sb = Awaited<ReturnType<typeof createServerClient>>

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 진척 스냅샷 조회(날짜 오름차순). numeric 컬럼은 문자열로 올 수 있어 Number 변환. */
export async function getSnapshots(projectId: string): Promise<SnapshotPoint[]> {
  const sb = await createServerClient()
  const { data } = await sb
    .from('wbs_progress_snapshots')
    .select('snap_date, actual_pct, planned_pct')
    .eq('project_id', projectId)
    .order('snap_date', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => ({
    date: r.snap_date as string,
    actual: Number(r.actual_pct),
    planned: Number(r.planned_pct),
  }))
}

/** 오늘(KST)의 전체 실적/계획%를 upsert. 본 작업을 실패시키지 않도록 오류는 삼키고 로그만 남긴다.
 *  실적 롤업은 날짜와 무관하고 계획%만 날짜 함수이므로, base_date와 무관하게 항상 실제 오늘로 계산한다.
 *  page 의 after() 안에서는 cookies() 호출이 불가 — 그 경로는 client 를 밖에서 만들어 넘긴다. */
export async function recordProgressSnapshot(projectId: string, client?: Sb): Promise<void> {
  try {
    const sb = client ?? (await createServerClient())
    const [{ data: items, error: itemsErr }, { data: hol, error: holErr }] = await Promise.all([
      sb.from('wbs_items')
        .select('id, parent_id, level, code, sort_order, name, planned_start, planned_end, weight, actual_pct')
        .eq('project_id', projectId),
      sb.from('holidays').select('date').eq('project_id', projectId),
    ])
    if (itemsErr || holErr) {
      // supabase-js는 RLS 거부·테이블 미존재를 throw하지 않고 {error}로 반환하므로 명시적으로 확인해 로그를 남긴다.
      console.error('[snapshot] wbs_items/holidays 조회 실패(무시):', (itemsErr ?? holErr)!.message)
      return
    }
    if (!items?.length) return
    const rows: WbsRow[] = items.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      parentId: (r.parent_id as string) ?? null,
      level: r.level as WbsRow['level'],
      code: r.code as string,
      sortOrder: r.sort_order as number,
      name: r.name as string,
      biz: null,
      deliverable: null,
      plannedStart: (r.planned_start as string) ?? null,
      plannedEnd: (r.planned_end as string) ?? null,
      weight: (r.weight as number) ?? null,
      actualPct: (r.actual_pct as number) ?? null,
      owners: [],
    }))
    const today = seoulToday()
    const holidays = new Set((hol ?? []).map((h: { date: string }) => h.date))
    const { actual, planned } = overallProgress(computeTree(rows, today, holidays))
    const { error: upsertErr } = await sb.from('wbs_progress_snapshots').upsert(
      { project_id: projectId, snap_date: today, actual_pct: actual, planned_pct: planned, updated_at: new Date().toISOString() },
      { onConflict: 'project_id,snap_date' },
    )
    if (upsertErr && upsertErr.code !== '42501') {
      // 42501(RLS 거부)은 게스트(비멤버) 조회 시 예상 가능한 소음이라 로그를 생략한다.
      console.error('[snapshot] upsert 실패(무시):', upsertErr.message)
    }
  } catch (e) {
    console.error('[snapshot] 진척 스냅샷 기록 실패(무시):', e)
  }
}
