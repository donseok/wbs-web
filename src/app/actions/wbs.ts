'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { DEMO } from '@/lib/demo'

export async function updateActual(itemId: string, newPct: number): Promise<{ ok: boolean; error?: string }> {
  if (newPct < 0 || newPct > 100) return { ok: false, error: '0~100 범위' }
  if (DEMO) return { ok: true } // 데모 모드: 저장 비활성화(둘러보기용)
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: item } = await sb.from('wbs_items').select('id, level, actual_pct, project_id').eq('id', itemId).single()
  if (!item) return { ok: false, error: '항목 없음' }
  if (item.level !== 'activity') return { ok: false, error: 'Activity만 입력 가능' }

  if (m.role !== 'pmo_admin') {
    const { data: owner } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).eq('team_id', m.teamId).maybeSingle()
    if (!owner) return { ok: false, error: '담당 작업이 아님' }
  }

  const old = item.actual_pct
  if (Number(old) === newPct) return { ok: true }
  const { error: upErr } = await sb.from('wbs_items').update({ actual_pct: newPct, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (upErr) return { ok: false, error: upErr.message }

  const { data: u } = await sb.auth.getUser()
  await sb.from('change_logs').insert({
    user_id: u.user?.id, wbs_item_id: itemId, field: 'actual_pct',
    old_value: old == null ? null : String(old), new_value: String(newPct),
  })
  revalidatePath(`/p/${item.project_id}/wbs`)
  return { ok: true }
}

export async function updateWeight(itemId: string, weight: number | null): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: true } // 데모 모드: 저장 비활성화(둘러보기용)
  if (weight != null && (typeof weight !== 'number' || Number.isNaN(weight) || weight < 0)) {
    return { ok: false, error: '가중치는 0 이상이어야 함' }
  }
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  // 가중치는 구조/롤업에 영향 → PMO만 허용
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const { data: item } = await sb.from('wbs_items').select('id, weight, project_id').eq('id', itemId).single()
  if (!item) return { ok: false, error: '항목 없음' }

  const old = item.weight
  if (Number(old ?? NaN) === Number(weight ?? NaN) && (old == null) === (weight == null)) return { ok: true }
  const { error: upErr } = await sb.from('wbs_items').update({ weight, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (upErr) return { ok: false, error: upErr.message }

  const { data: u } = await sb.auth.getUser()
  await sb.from('change_logs').insert({
    user_id: u.user?.id, wbs_item_id: itemId, field: 'weight',
    old_value: old == null ? null : String(old), new_value: weight == null ? null : String(weight),
  })
  revalidatePath(`/p/${item.project_id}/wbs`)
  return { ok: true }
}
