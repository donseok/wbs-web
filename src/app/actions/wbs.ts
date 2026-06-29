'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function updateActual(itemId: string, newPct: number): Promise<{ ok: boolean; error?: string }> {
  if (newPct < 0 || newPct > 100) return { ok: false, error: '0~100 범위' }
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
