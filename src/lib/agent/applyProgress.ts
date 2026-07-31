import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 에이전트 progress 보고의 WBS 실적 반영 — 스펙 §4.
 * actions/wbs.ts updateActual 과 같은 3종 세트(actual_pct + change_logs + 스냅샷)를 만들되,
 * 세션이 없는 라우트 컨텍스트라 admin(service_role) 로 쓴다. 스냅샷·revalidate 는 호출부 몫.
 *
 * updateActual 의 담당팀(item_owners) 검사는 여기 없다 — 주문 발행이 프로젝트 관리자
 * 전용이므로(스펙 §5) 항목 선정 검증은 발행 시점에 이미 끝났다.
 */
export async function applyAgentProgress(
  admin: AdminClient,
  args: { wbsItemId: string; percent: number; actorUserId: string },
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const { wbsItemId, percent, actorUserId } = args
  if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
    return { ok: false, error: 'percent는 0~99 정수여야 합니다.' }
  }
  // 쓰기 선행조회 — 실패는 중단(3원칙).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('id, actual_pct, project_id').eq('id', wbsItemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  const row = item as { id: string; actual_pct: number | null; project_id: string }

  // 동일값 재보고 단락 — updateActual 관례(src/app/actions/wbs.ts). 중복 보고 멱등화 + change_logs 로그 노이즈 방지.
  if (Number(row.actual_pct) === percent) return { ok: true, projectId: row.project_id }

  const { data: child, error: childErr } = await admin
    .from('wbs_items').select('id').eq('parent_id', wbsItemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: false, error: '하위 항목이 있어 롤업으로 계산됩니다' }

  const { data: updated, error: upErr } = await admin
    .from('wbs_items')
    .update({ actual_pct: percent, updated_at: new Date().toISOString() })
    .eq('id', wbsItemId)
    .select('id')
  if (upErr) return { ok: false, error: upErr.message }
  if (!updated || (updated as unknown[]).length === 0) return { ok: false, error: '갱신 대상 없음' }

  // 본 저장 성공 후의 이력 실패는 되돌리지 않되 조용히 삼키지도 않는다(updateActual 관례).
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: actorUserId, wbs_item_id: wbsItemId, field: 'actual_pct',
    old_value: row.actual_pct == null ? null : String(row.actual_pct), new_value: String(percent),
  })
  if (logErr) console.error('[agent-api] 변경 이력 기록 실패:', logErr.message)

  return { ok: true, projectId: row.project_id }
}
