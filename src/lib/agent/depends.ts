import type { AdminClient } from '@/lib/minutes/externalApi'
import { predecessorReached } from '@/lib/domain/agentWork'

export type DependInfo = {
  external_ref: string; stage: string | null; branch: string | null; head_sha: string | null
  /**
   * 선행 항목에 approved 주문이 있는가 — claim 게이트의 두 번째 충족 축(2026-08-25).
   * stage 만 보면 승인이 반쪽으로 끝난 선행(status=approved 인데 stage 는 그대로)이 후속을
   * 영구히 막고, 그 교착은 자동 루프가 스스로 못 푼다(mes-runlog 리허설 3회 재발).
   * 사람이 "이 일은 끝났다"고 판정한 사실 자체는 approved 주문에 이미 기록돼 있다.
   */
  order_approved: boolean
  /** 선행 실적%(스펙 2026-09-15 §3.7 세 번째 축) — 프로젝트에 없는 ref 는 null. */
  actual_pct: number | null
  /**
   * 선행 충족 판정 결과(계약 v2.3) = stage ∈ {im,xx} ∨ order_approved ∨ actual_pct ≥ 100. claim 게이트와 같은
   * 함수(predecessorReached)라, 스킬은 축을 다시 조합하지 않고 이 값을 본다.
   */
  reached: boolean
  /** 강제 진행으로 면제한 간선(계약 v2.8, 0103 depends_waived). 참이면 reached 도 참이다. head_sha 가 없는 것이 정상이다. */
  waived: boolean
}

/**
 * claim·GET /work/{id}(PAT) 응답이 공유하는 항목 상세 컬럼 — 배정·선행 게이트·클라이언트
 * spec.md 캐시(결정 A) 재료를 한 번의 select 로 담는다.
 */
export const ITEM_DETAIL_COLUMNS =
  'id, code, name, external_ref, stage, category, domain, priority, model, tags, depends, ' +
  'prd_ref, entry_point, acceptance, spec, agent_prompt, assignee_member_id, planned_start, planned_end, depends_waived, stub_for'

/**
 * 선행 정보 — stage 는 게이트 재료(결정 C-①), evidence 는 클라이언트 로컬 도달 검사 재료(C-②).
 * 프로젝트에 없는 ref 는 { stage: null, branch: null, head_sha: null } 로 반환(미충족 판정 재료 — fail-closed).
 */
export async function loadDependsInfo(
  admin: AdminClient,
  args: { projectId: string; depends: string[]; waived?: string[] },
): Promise<DependInfo[]> {
  const { data: items, error } = await admin
    .from('wbs_items').select('id, external_ref, stage, actual_pct')
    .eq('project_id', args.projectId).in('external_ref', args.depends)
  if (error) throw new Error(`선행 항목 조회 실패: ${error.message}`) // 게이트 재료 — 위장 금지(호출부 500)
  const byRef = new Map(
    (items ?? []).map((i) => [(i as { external_ref: string }).external_ref, i]) as Array<
      [string, { id: string; stage: string | null; actual_pct: number | string | null }]
    >,
  )
  const out: DependInfo[] = []
  for (const ref of args.depends) {
    // 면제(강제 진행, 스펙 2026-09-23 F2) — claim 게이트도 통과한다. 선행이 프로젝트에 없어도 면제가 먼저다.
    const waived = (args.waived ?? []).includes(ref)
    const item = byRef.get(ref)
    if (!item) { out.push({ external_ref: ref, stage: null, branch: null, head_sha: null, order_approved: false, actual_pct: null, reached: waived, waived }); continue }
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
    const actualPct = item.actual_pct == null ? null : Number(item.actual_pct)
    out.push({
      external_ref: ref, stage: item.stage, branch, head_sha: headSha, order_approved: order !== null, actual_pct: actualPct,
      reached: predecessorReached({ stage: item.stage, orderApproved: order !== null, actualPct, waived }),
      waived,
    })
  }
  return out
}

/**
 * 설계 선행(계약 v2.9, 스펙 2026-09-26 §6.3)이 너무 이른가 — 미충족 선행 중 하나라도 ip(구현 중)가 아니면 참.
 * 미착수(null)·as·ds(선행도 설계만 하는 중)·프로젝트에 없는 ref(stage null) 가 여기에 든다. im·xx 는 이미 reached 라
 * 미충족 목록에 없다. 호출부는 미충족(reached=false) 목록만 넘긴다.
 */
export const DESIGN_FIRST_PRED_STAGE = 'ip'
export function designFirstTooEarly(unmet: readonly Pick<DependInfo, 'stage'>[]): boolean {
  return unmet.some((d) => d.stage !== DESIGN_FIRST_PRED_STAGE)
}
