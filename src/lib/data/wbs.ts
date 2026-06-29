import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow, ComputedItem, TeamCode, OwnerKind } from '@/lib/domain/types'
import { DEMO, loadDemoWbs } from '@/lib/demo'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

// 같은 요청 내 layout+page 중복 호출을 1회로 dedupe(React cache).
export const getComputedWbs = cache(async (
  projectId: string,
): Promise<{ items: ComputedItem[]; holidays: string[]; today: string }> => {
  if (DEMO) return loadDemoWbs()
  const sb = await createServerClient()
  const [{ data: items }, { data: ownerRows }, { data: hol }, { data: proj }] = await Promise.all([
    sb.from('wbs_items').select('*').eq('project_id', projectId),
    sb.from('item_owners').select('wbs_item_id, kind, teams(code)'),
    sb.from('holidays').select('date').eq('project_id', projectId),
    sb.from('projects').select('base_date').eq('id', projectId).maybeSingle(),
  ])

  const ownerMap = new Map<string, { team: TeamCode; kind: OwnerKind }[]>()
  ;(ownerRows ?? []).forEach((o: Record<string, unknown>) => {
    const team = o.teams as { code: TeamCode } | { code: TeamCode }[] | null
    const code = (Array.isArray(team) ? team[0]?.code : team?.code) as TeamCode | undefined
    if (!code) return
    const wbsItemId = o.wbs_item_id as string
    const arr = ownerMap.get(wbsItemId) ?? []
    arr.push({ team: code, kind: o.kind as OwnerKind })
    ownerMap.set(wbsItemId, arr)
  })

  const rows: WbsRow[] = (items ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    parentId: r.parent_id as string | null,
    level: r.level as WbsRow['level'],
    code: r.code as string,
    sortOrder: r.sort_order as number,
    name: r.name as string,
    biz: (r.biz as string) ?? null,
    deliverable: (r.deliverable as string) ?? null,
    plannedStart: (r.planned_start as string) ?? null,
    plannedEnd: (r.planned_end as string) ?? null,
    weight: (r.weight as number) ?? null,
    actualPct: (r.actual_pct as number) ?? null,
    owners: ownerMap.get(r.id as string) ?? [],
  }))

  const holidays = new Set((hol ?? []).map((h: { date: string }) => h.date))
  // base_date(공정율 기준일)가 설정돼 있으면 그 날짜로, 없으면 오늘(자동)로 산정
  const today = (proj as { base_date: string | null } | null)?.base_date ?? seoulToday()
  return { items: computeTree(rows, today, holidays), holidays: [...holidays], today }
})
