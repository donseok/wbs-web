import type { AdminClient } from '@/lib/minutes/externalApi'

export type DependInfo = {
  external_ref: string; stage: string | null; branch: string | null; head_sha: string | null
  /**
   * 선행 항목에 approved 주문이 있는가 — claim 게이트의 두 번째 충족 축(2026-08-25).
   * stage 만 보면 승인이 반쪽으로 끝난 선행(status=approved 인데 stage 는 그대로)이 후속을
   * 영구히 막고, 그 교착은 자동 루프가 스스로 못 푼다(mes-runlog 리허설 3회 재발).
   * 사람이 "이 일은 끝났다"고 판정한 사실 자체는 approved 주문에 이미 기록돼 있다.
   */
  order_approved: boolean
}

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
    if (!item) { out.push({ external_ref: ref, stage: null, branch: null, head_sha: null, order_approved: false }); continue }
    // 최근 approved 주문 → 최신 completion 보고의 evidence
    let branch: string | null = null
    let headSha: string | null = null
    const { data: order, error: orderErr } = await admin
      .from('agent_work_orders').select('id').eq('wbs_item_id', item.id).eq('status', 'approved')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    // 게이트 재료 — 위장 금지(호출부 500). 조회가 깨진 것과 선행이 미승인인 것이 똑같이
    // order_approved:false 로 나오면 둘을 구별할 방법이 없다(2026-08-27 추적이 여기서 헤맸다).
    if (orderErr) throw new Error(`선행 주문 조회 실패: ${orderErr.message}`)
    if (order) {
      const { data: rep, error: repErr } = await admin
        .from('agent_work_reports').select('evidence').eq('work_order_id', (order as { id: string }).id)
        .eq('kind', 'completion').order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (repErr) throw new Error(`선행 완료 보고 조회 실패: ${repErr.message}`)
      const ev = (rep as { evidence?: Record<string, unknown> } | null)?.evidence ?? {}
      branch = typeof ev.branch === 'string' ? ev.branch : null
      headSha = typeof ev.head_sha === 'string' ? ev.head_sha : null
    }
    out.push({ external_ref: ref, stage: item.stage, branch, head_sha: headSha, order_approved: order !== null })
  }
  return out
}
