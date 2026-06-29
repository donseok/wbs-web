'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { DEMO } from '@/lib/demo'
import type { TeamCode } from '@/lib/domain/types'

export interface ChangeLogEntry {
  id: number
  field: string
  oldValue: string | null
  newValue: string | null
  at: string
  actorTeam: TeamCode | null
  actorRole: string | null
}

/** 항목의 변경 이력 조회 — 실적%/가중치 편집 시 기록된 change_logs를 최신순으로.
 *  user_id의 표시 이름은 프로필 테이블이 없어 memberships의 팀/역할로 대체한다. */
export async function getChangeLogs(itemId: string): Promise<ChangeLogEntry[]> {
  if (DEMO) return []
  const sb = await createServerClient()
  const { data: logs } = await sb
    .from('change_logs')
    .select('id, field, old_value, new_value, at, user_id')
    .eq('wbs_item_id', itemId)
    .order('at', { ascending: false })
    .limit(50)
  if (!logs?.length) return []

  const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean) as string[])]
  const actorMap = new Map<string, { team: TeamCode | null; role: string | null }>()
  if (userIds.length) {
    const { data: mems } = await sb.from('memberships').select('user_id, role, teams(code)').in('user_id', userIds)
    ;(mems ?? []).forEach((m: Record<string, unknown>) => {
      const t = m.teams as { code: TeamCode } | { code: TeamCode }[] | null
      const code = (Array.isArray(t) ? t[0]?.code : t?.code) ?? null
      actorMap.set(m.user_id as string, { team: code, role: (m.role as string) ?? null })
    })
  }

  return logs.map(l => {
    const actor = l.user_id ? actorMap.get(l.user_id as string) : undefined
    return {
      id: l.id as number,
      field: l.field as string,
      oldValue: (l.old_value as string) ?? null,
      newValue: (l.new_value as string) ?? null,
      at: l.at as string,
      actorTeam: actor?.team ?? null,
      actorRole: actor?.role ?? null,
    }
  })
}

export async function updateActual(
  itemId: string,
  newPct: number,
  expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
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
  // 낙관적 잠금: 편집 시작 시 본 값과 DB 현재값이 다르면 그새 다른 사용자가 바꾼 것.
  if (expectedCurrent !== undefined && Number(old ?? 0) !== Number(expectedCurrent ?? 0)) {
    return { ok: false, conflict: true, error: '다른 사용자가 먼저 수정했습니다. 최신 값으로 새로고침합니다.' }
  }
  if (Number(old) === newPct) return { ok: true }
  const { error: upErr } = await sb.from('wbs_items').update({ actual_pct: newPct, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (upErr) return { ok: false, error: upErr.message }

  const { data: u } = await sb.auth.getUser()
  await sb.from('change_logs').insert({
    user_id: u.user?.id, wbs_item_id: itemId, field: 'actual_pct',
    old_value: old == null ? null : String(old), new_value: String(newPct),
  })
  revalidatePath(`/p/${item.project_id}`, 'layout')
  return { ok: true }
}

export async function updateWeight(
  itemId: string,
  weight: number | null,
  expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
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
  // 낙관적 잠금: 편집 시작 시 값과 DB 현재값이 다르면 충돌(null=균등도 구분).
  if (expectedCurrent !== undefined) {
    const a = old == null ? null : Number(old)
    const b = expectedCurrent == null ? null : Number(expectedCurrent)
    if (a !== b) return { ok: false, conflict: true, error: '다른 사용자가 먼저 수정했습니다. 최신 값으로 새로고침합니다.' }
  }
  if (Number(old ?? NaN) === Number(weight ?? NaN) && (old == null) === (weight == null)) return { ok: true }
  const { error: upErr } = await sb.from('wbs_items').update({ weight, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (upErr) return { ok: false, error: upErr.message }

  const { data: u } = await sb.auth.getUser()
  await sb.from('change_logs').insert({
    user_id: u.user?.id, wbs_item_id: itemId, field: 'weight',
    old_value: old == null ? null : String(old), new_value: weight == null ? null : String(weight),
  })
  revalidatePath(`/p/${item.project_id}`, 'layout')
  return { ok: true }
}
