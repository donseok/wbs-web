import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { computeTree } from '@/lib/domain/rollup'
import { computeCompletionMap, type ProjectCompletion } from '@/lib/domain/project-status'
import type { WbsRow, ComputedItem, TeamCode, OwnerKind } from '@/lib/domain/types'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

// 같은 요청 내 layout+page 중복 호출을 1회로 dedupe(React cache).
export const getComputedWbs = cache(async (
  projectId: string,
): Promise<{ items: ComputedItem[]; holidays: string[]; today: string }> => {
  const sb = await createServerClient()
  const [
    { data: items, error: itemsErr },
    { data: ownerRows, error: ownersErr },
    { data: hol, error: holErr },
    { data: proj, error: projErr },
  ] = await Promise.all([
    sb.from('wbs_items').select('*').eq('project_id', projectId),
    sb.from('item_owners').select('wbs_item_id, kind, teams(code)'),
    sb.from('holidays').select('date').eq('project_id', projectId),
    sb.from('projects').select('base_date').eq('id', projectId).maybeSingle(),
  ])

  // 네 조회 모두 실패를 '없음'으로 폴백하면 화면이 비는 게 아니라 '조용히 틀린 화면/숫자'가 된다.
  // - wbs_items: 빈 트리 → 대시보드가 'WBS 데이터 없음' EmptyState를 띄워 운영 데이터 위 재임포트를 유도한다(최악).
  // - item_owners: 담당 배지·행 분리가 사라져 팀 편집 권한이 회수된 것처럼 보인다.
  // - holidays: 빈 배열이 '공휴일 없음'(정상)과 구분되지 않아, 영업일 기반 계획%가 틀어져도 아무도 감지할 수 없다.
  //   (정상적으로 0건인 경우와 달리 error는 명백한 실패이므로 여기서만 throw — 빈 결과는 그대로 통과시킨다.)
  // - projects.base_date: 기준일이 조용히 오늘로 바뀌어 전 지표(계획%·지연 판정·PPT·봇 답변)가 어긋난다.
  // 계산 결과가 알림/리포트/임베딩 쓰기로도 흘러가므로, 에러 바운더리('문제가 발생했습니다')가 조용한 오염보다 안전하다.
  for (const [table, err] of [
    ['wbs_items', itemsErr],
    ['item_owners', ownersErr],
    ['holidays', holErr],
    ['projects', projErr],
  ] as const) {
    if (err) throw new Error(`[getComputedWbs] ${table} 조회 실패: ${err.message}`)
  }

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
  // DB가 순서를 보장하지 않으므로 표시 순서를 고정: 주관 먼저, 팀은 PMO→ERP→MES→가공.
  // (담당별 행 분리 UI에서 순서가 요청마다 바뀌면 같은 항목의 행 배치가 흔들린다.)
  const teamOrder: Record<TeamCode, number> = { PMO: 0, ERP: 1, MES: 2, 가공: 3 }
  ownerMap.forEach(arr =>
    arr.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'primary' ? -1 : 1) || teamOrder[a.team] - teamOrder[b.team],
    ),
  )

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

// 사이드바용 경량 완료율 맵 — 프로젝트 전체를 1쿼리로 (트리 로드 없이)
// 반환 null = 조회 실패. 빈 맵({})과 반드시 구분해야 한다 — 빈 맵은 'WBS가 없는 프로젝트'라는 정상 상태이고,
// 실패를 그것과 같게 취급하면 종료일 지난 미완 프로젝트가 '완료' 배지로 둔갑한다(projectLifecycleStatus).
export const getProjectsCompletion = cache(
  async (projectIds: string[]): Promise<Record<string, ProjectCompletion> | null> => {
    if (!projectIds.length) return {}
    const sb = await createServerClient()
    const { data, error } = await sb
      .from('wbs_items')
      .select('id, parent_id, project_id, actual_pct')
      .in('project_id', projectIds)

    // 표시 전용이라 throw하지 않는다 — 이 함수는 앱 루트 layout에서 호출되므로 throw하면 배지 하나 때문에
    // 모든 페이지가 에러 화면이 된다(복구 경로인 설정/임포트까지 막힌다). 대신 실패를 null로 신호한다.
    if (error) {
      console.error('[getProjectsCompletion] 조회 실패:', error.message)
      return null
    }

    return computeCompletionMap(
      (data ?? []).map(r => ({
        id: r.id as string,
        parentId: (r.parent_id as string | null) ?? null,
        projectId: r.project_id as string,
        actualPct: (r.actual_pct as number | null) ?? null,
      })),
    )
  },
)
