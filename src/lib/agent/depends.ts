import type { AdminClient } from '@/lib/minutes/externalApi'

export type DependInfo = { external_ref: string; stage: string | null; branch: string | null; head_sha: string | null }

/**
 * claim·GET /work/{id}(PAT) 응답이 공유하는 항목 상세 컬럼 — 배정·선행 게이트·클라이언트
 * spec.md 캐시(결정 A) 재료를 한 번의 select 로 담는다.
 */
export const ITEM_DETAIL_COLUMNS =
  'id, code, name, external_ref, stage, category, domain, priority, model, tags, depends, ' +
  'prd_ref, entry_point, acceptance, spec, agent_prompt, assignee_member_id, planned_start, planned_end'

/**
 * 선행 정보 — stage 는 게이트 재료(결정 C-①), evidence 는 클라이언트 로컬 도달 검사 재료(C-②).
 * 프로젝트에 없는 ref 는 { stage: null, branch: null, head_sha: null } 로 반환(미충족 판정 재료 — fail-closed).
 */
export async function loadDependsInfo(
  admin: AdminClient,
  args: { projectId: string; depends: string[] },
): Promise<DependInfo[]> {
  const { data: items, error } = await admin
    .from('wbs_items').select('id, external_ref, stage')
    .eq('project_id', args.projectId).in('external_ref', args.depends)
  if (error) throw new Error(`선행 항목 조회 실패: ${error.message}`) // 게이트 재료 — 위장 금지(호출부 500)
  const byRef = new Map(
    (items ?? []).map((i) => [(i as { external_ref: string }).external_ref, i]) as Array<
      [string, { id: string; stage: string | null }]
    >,
  )
  const out: DependInfo[] = []
  for (const ref of args.depends) {
    const item = byRef.get(ref)
    if (!item) { out.push({ external_ref: ref, stage: null, branch: null, head_sha: null }); continue }
    // 최근 approved 주문 → 최신 completion 보고의 evidence
    let branch: string | null = null
    let headSha: string | null = null
    const { data: order } = await admin
      .from('agent_work_orders').select('id').eq('wbs_item_id', item.id).eq('status', 'approved')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (order) {
      const { data: rep } = await admin
        .from('agent_work_reports').select('evidence').eq('work_order_id', (order as { id: string }).id)
        .eq('kind', 'completion').order('created_at', { ascending: false }).limit(1).maybeSingle()
      const ev = (rep as { evidence?: Record<string, unknown> } | null)?.evidence ?? {}
      branch = typeof ev.branch === 'string' ? ev.branch : null
      headSha = typeof ev.head_sha === 'string' ? ev.head_sha : null
    }
    out.push({ external_ref: ref, stage: item.stage, branch, head_sha: headSha })
  }
  return out
}
