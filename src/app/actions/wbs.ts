'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import type { Level, OwnerKind, TeamCode } from '@/lib/domain/types'
import { subActName } from '@/lib/domain/subact'

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
  const sb = await createServerClient()
  // 표시 전용 조회 — 실패해도 빈 이력으로 폴백하되(화면은 비어도 안전), 원인은 로그에 남긴다.
  const { data: logs, error: logErr } = await sb
    .from('change_logs')
    .select('id, field, old_value, new_value, at, user_id')
    .eq('wbs_item_id', itemId)
    .order('at', { ascending: false })
    .limit(50)
  if (logErr) console.error('[getChangeLogs] 변경 이력 조회 실패:', logErr.message)
  if (!logs?.length) return []

  const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean) as string[])]
  const actorMap = new Map<string, { team: TeamCode | null; role: string | null }>()
  if (userIds.length) {
    const { data: mems, error: memErr } = await sb.from('memberships').select('user_id, role, teams(code)').in('user_id', userIds)
    if (memErr) console.error('[getChangeLogs] 작성자 정보 조회 실패:', memErr.message)
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

/** 실적% 입력 — 말단(자식 없는) 항목만. level 은 보지 않는다: 롤업(computeNode)이 자식 유무로
 *  말단을 판정하므로, 자식 없는 Task/Phase 도 자기 actual_pct 가 그대로 상위로 올라간다.
 *  UI 게이트 canEditActual 과 동일 불변식. */
export async function updateActual(
  itemId: string,
  newPct: number,
  expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
  if (!Number.isFinite(newPct) || newPct < 0 || newPct > 100) return { ok: false, error: '0~100 범위' }
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  // PGRST116 = 0행(항목 없음). 그 외 에러는 진성 조회 실패이므로 '항목 없음'으로 위장하지 않고 그대로 알린다.
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('id, actual_pct, project_id').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  // 자식이 있으면 롤업 부모 — 직접 입력한 값은 화면에도 엑셀에도 안 나오므로 거부한다.
  // 조회 실패를 '자식 없음'으로 오인하면 롤업 부모에 실적%가 박혀 화면엔 안 보이는 유령 값이 남는다 → 실패는 거부.
  const { data: child, error: childErr } = await sb.from('wbs_items').select('id').eq('parent_id', itemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: false, error: '하위 항목이 있어 롤업으로 계산됩니다' }

  if (m.role !== 'pmo_admin') {
    // 권한 가드 — 조회 실패를 '담당 아님'이 아니라 통과로 흘려보내면 안 된다. 실패 = 거부(fail-closed).
    const { data: owner, error: ownerErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).eq('team_id', m.teamId).maybeSingle()
    if (ownerErr) return { ok: false, error: `담당 확인 실패: ${ownerErr.message}` }
    if (!owner) return { ok: false, error: '담당 작업이 아님' }
  }

  const old = item.actual_pct
  // 낙관적 잠금: 편집 시작 시 본 값과 DB 현재값이 다르면 그새 다른 사용자가 바꾼 것.
  if (expectedCurrent !== undefined && Number(old ?? 0) !== Number(expectedCurrent ?? 0)) {
    return { ok: false, conflict: true, error: '다른 사용자가 먼저 수정했습니다. 최신 값으로 새로고침합니다.' }
  }
  if (Number(old) === newPct) return { ok: true }
  // .select() 필수 — RLS 가 행을 가리면 supabase-js 는 error 없이 0행을 돌려준다.
  // 그대로 두면 저장 실패가 "저장됨" 토스트로 둔갑한다.
  const { data: updated, error: upErr } = await sb
    .from('wbs_items')
    .update({ actual_pct: newPct, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('id')
  if (upErr) return { ok: false, error: upErr.message }
  if (!updated?.length) return { ok: false, error: '저장 권한이 없습니다(담당 팀·PMO만 입력 가능)' }

  const { data: u } = await sb.auth.getUser()
  // 본 저장은 이미 성공했다 — 이력 기록 실패로 되돌리지는 않되, 조용히 삼키지도 않는다(감사 추적 유실 원인 기록).
  const { error: logInsErr } = await sb.from('change_logs').insert({
    user_id: u.user?.id, wbs_item_id: itemId, field: 'actual_pct',
    old_value: old == null ? null : String(old), new_value: String(newPct),
  })
  if (logInsErr) console.error('[updateActual] 변경 이력 기록 실패:', logInsErr.message)
  revalidatePath(`/p/${item.project_id}`, 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
}

export async function updateWeight(
  itemId: string,
  weight: number | null,
  expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
  // isFinite: Infinity는 JSON 직렬화에서 null(균등)로 둔갑해 이력과 어긋나므로 차단
  if (weight != null && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)) {
    return { ok: false, error: '가중치는 0 이상이어야 함' }
  }
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  // 가중치는 구조/롤업에 영향 → PMO만 허용
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('id, weight, project_id').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${itemErr.message}` } // 실패를 '항목 없음'으로 위장 금지
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
  const { error: logInsErr } = await sb.from('change_logs').insert({
    user_id: u.user?.id, wbs_item_id: itemId, field: 'weight',
    old_value: old == null ? null : String(old), new_value: weight == null ? null : String(weight),
  })
  if (logInsErr) console.error('[updateWeight] 변경 이력 기록 실패:', logInsErr.message) // 본 저장은 성공 — 이력만 유실
  revalidatePath(`/p/${item.project_id}`, 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
}

/* ── PMO 수동 WBS 트리 편집 (구조·일정) — 모두 PMO 전용, change_logs 기록 ── */

type Sb = Awaited<ReturnType<typeof createServerClient>>

/** 말단이던 항목이 첫 자식을 얻어 롤업 부모가 될 때, 직접 입력돼 있던 실적%를 지운다.
 *  남겨 두면 롤업이 가려 화면엔 안 보이지만, 그 자식을 나중에 지우는 순간 옛 값이 되살아난다
 *  (rollup: 자식 없으면 actualPct ?? 0). UI 경고(willDiscardActual)가 약속한 "대체됨"을 실제로 이행한다.
 *  베스트에포트 — 이미 성공한 자식 추가를 되돌리지는 않되, 실패를 change_logs 에 성공으로 남기지도 않는다. */
async function discardRolledUpActual(
  sb: Sb, parentId: string, projectId: string, userId: string | undefined,
): Promise<void> {
  // project_id 동시 확인 — 호출자가 넘긴 parentId 가 다른 프로젝트 행이면 남의 실적을 지우게 된다.
  // 조회 실패 시엔 지우지 않는다(파괴적 쓰기를 추측으로 하지 않음). 자식 추가는 이미 커밋됐으므로 되돌리지 못하고,
  // 부모에 옛 실적%가 남아 나중에 되살아날 수 있으니 원인을 반드시 로그로 남긴다.
  const { data: parent, error: parentErr } = await sb
    .from('wbs_items').select('actual_pct').eq('id', parentId).eq('project_id', projectId).maybeSingle()
  if (parentErr) {
    console.error('[discardRolledUpActual] 부모 실적% 조회 실패 — 정리를 건너뜁니다:', parentErr.message)
    return
  }
  const old = parent?.actual_pct
  if (old == null) return
  const { data: cleared, error } = await sb
    .from('wbs_items')
    .update({ actual_pct: null, updated_at: new Date().toISOString() })
    .eq('id', parentId)
    .select('id')
  // 정리에 실패하면 부모에 옛 실적%가 남아 자식이 지워지는 순간 되살아난다 — 조용히 삼키지 않고 원인을 남긴다.
  if (error) {
    console.error(`[discardRolledUpActual] 부모(${parentId}) 실적% 정리 실패 — 옛 값이 남습니다:`, error.message)
    return
  }
  // RLS 차단은 error 없이 0행으로 온다 — 실제로 지워지지 않았으므로 이력도 남기지 않는다.
  if (!cleared?.length) {
    console.error(`[discardRolledUpActual] 부모(${parentId}) 실적% 정리 0행(RLS 차단 추정) — 옛 값이 남습니다`)
    return
  }
  await sb.from('change_logs').insert({
    user_id: userId, wbs_item_id: parentId, field: 'actual_pct', old_value: String(old), new_value: null,
  })
}

/** 하위(또는 루트 Phase) 항목 추가. level은 호출자가 부모 기준으로 결정. */
export async function addWbsItem(
  projectId: string, parentId: string | null, level: Level, name: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  if (!name.trim()) return { ok: false, error: '이름을 입력하세요' }
  const sb = await createServerClient()
  let q = sb.from('wbs_items').select('sort_order').eq('project_id', projectId)
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null)
  // 형제 조회 실패를 '형제 0개'로 오인하면 (1) sort_order 가 1로 충돌하고 (2) 아래에서 '첫 자식'으로 착각해
  // 부모의 직접 입력 실적%를 지운다. 둘 다 되돌릴 수 없으니 쓰기 전에 중단한다.
  const { data: sibs, error: sibErr } = await q
  if (sibErr || !sibs) return { ok: false, error: `형제 항목 조회 실패: ${sibErr?.message ?? '알 수 없는 오류'}` }
  const nextOrder = sibs.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 1
  const code = name.trim().split(/[.\s]/)[0] || level
  const { data, error } = await sb
    .from('wbs_items')
    .insert({ project_id: projectId, parent_id: parentId, level, code, sort_order: nextOrder, name: name.trim() })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  const { data: u } = await sb.auth.getUser()
  const { error: logInsErr } = await sb.from('change_logs').insert({ user_id: u.user?.id, wbs_item_id: data.id, field: 'created', old_value: null, new_value: name.trim() })
  if (logInsErr) console.error('[addWbsItem] 변경 이력 기록 실패:', logInsErr.message) // 항목 생성은 성공 — 이력만 유실
  // 부모가 방금 말단에서 롤업 부모로 바뀌었다면 남아 있던 직접 입력 실적%를 정리(sibs 는 위에서 검증된 실제 형제 목록).
  if (parentId && sibs.length === 0) await discardRolledUpActual(sb, parentId, projectId, u.user?.id)
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
  return { ok: true, id: data.id as string }
}

/** ACT(자식 있는/없는 activity) 하위에 담당 팀별 SUB-ACT(활동 자식) 1개 추가 — PMO 전용.
 *  임포트 분리(splitLeafOwners)와 같은 모양을 손으로 재현한다:
 *   - level='activity', 이름 "{ACT명} ({팀} 주관/지원)", 코드·계획일정·biz·산출물 상속, 가중치 균등, 실적 0(=null).
 *   - 담당 1팀(item_owners) 필수 — 없으면 팀 배지가 없고 정렬 맨 뒤, 팀 편집자가 실적% 입력 불가.
 *   - 부모 ACT 에도 그 팀 담당 표기를 넣어 엑셀 내보내기→재임포트 라운드트립에서 SUB-ACT 가 사라지지 않게 한다.
 *  1단계만 허용(SUB-ACT 아래엔 불가) — 엑셀 3단(Phase/Task/Activity) 형식을 유지하기 위함. */
export async function addSubAct(
  actId: string, team: TeamCode, kind: OwnerKind,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const sb = await createServerClient()

  const { data: act, error: actErr } = await sb
    .from('wbs_items')
    .select('id, project_id, parent_id, level, code, name, biz, deliverable, planned_start, planned_end')
    .eq('id', actId).single()
  if (actErr && actErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${actErr.message}` } // 0행(PGRST116)만 '항목 없음'
  if (!act) return { ok: false, error: '항목 없음' }
  if (act.level !== 'activity') return { ok: false, error: 'SUB-ACT는 ACT(활동) 하위에만 추가할 수 있습니다' }
  // 1단계 제한: 부모가 activity(=자기 자신이 SUB-ACT)면 그 아래로는 불가.
  // 구조 가드 — 조회 실패를 '부모 아님'으로 흘리면 SUB-ACT 아래 SUB-ACT 가 생겨 엑셀 3단 구조가 깨진다. 실패 = 거부.
  if (act.parent_id) {
    const { data: parent, error: parentErr } = await sb.from('wbs_items').select('level').eq('id', act.parent_id).maybeSingle()
    if (parentErr) return { ok: false, error: `상위 항목 확인 실패: ${parentErr.message}` }
    if (parent?.level === 'activity') return { ok: false, error: 'SUB-ACT 아래에는 추가할 수 없습니다' }
  }

  const { data: teamRow, error: teamErr } = await sb.from('teams').select('id').eq('code', team).maybeSingle()
  if (teamErr) return { ok: false, error: `담당 팀 조회 실패: ${teamErr.message}` } // 실패를 '팀 없음'으로 위장 금지
  if (!teamRow) return { ok: false, error: '담당 팀을 찾을 수 없습니다' }
  const teamId = teamRow.id as string

  // 형제(기존 SUB-ACT) 조회 — 중복 팀 방지 + sort_order 채번.
  // 조회 실패를 '형제 0개'로 오인하면 sort_order 충돌 + 중복 팀 검사 무력화 + '첫 SUB-ACT' 오판으로
  // ACT 의 직접 입력 실적%까지 지운다. 쓰기 전에 중단한다.
  const { data: sibs, error: sibErr } = await sb.from('wbs_items').select('id, sort_order').eq('parent_id', actId)
  if (sibErr || !sibs) return { ok: false, error: `기존 SUB-ACT 조회 실패: ${sibErr?.message ?? '알 수 없는 오류'}` }
  const sibIds = sibs.map(s => s.id as string)
  if (sibIds.length) {
    const { data: dup, error: dupErr } = await sb
      .from('item_owners').select('wbs_item_id').eq('team_id', teamId).in('wbs_item_id', sibIds).limit(1).maybeSingle()
    if (dupErr) return { ok: false, error: `중복 담당 팀 확인 실패: ${dupErr.message}` } // 실패 = 거부(중복 SUB-ACT 생성 방지)
    if (dup) return { ok: false, error: '이미 해당 팀의 SUB-ACT가 있습니다' }
  }
  const nextOrder = sibs.reduce((mx, r) => Math.max(mx, Number(r.sort_order) || 0), 0) + 1

  const name = subActName(act.name as string, team, kind)
  const { data: inserted, error: insErr } = await sb
    .from('wbs_items')
    .insert({
      project_id: act.project_id, parent_id: actId, level: 'activity', code: act.code,
      sort_order: nextOrder, name, biz: act.biz, deliverable: act.deliverable,
      planned_start: act.planned_start, planned_end: act.planned_end, weight: null, actual_pct: null,
    })
    .select('id').single()
  if (insErr || !inserted) return { ok: false, error: insErr?.message ?? '추가 실패' }
  const newId = inserted.id as string

  const { error: ownErr } = await sb.from('item_owners').insert({ wbs_item_id: newId, team_id: teamId, kind })
  if (ownErr) {
    // 담당 없는 고아 SUB-ACT 를 남기지 않도록 방금 만든 행 정리 후 실패 반환.
    await sb.from('wbs_items').delete().eq('id', newId)
    return { ok: false, error: ownErr.message }
  }

  // 부모 ACT 에 담당 팀 표기 보강(라운드트립 안정용) — 이미 있으면 그대로 둔다. 베스트에포트.
  // 선행 조회 없이 바로 insert 한다: PK 가 (wbs_item_id, team_id) 라 '이미 있음'은 DB 가 23505 로 막아 준다
  // (= 중복은 정상 경로). 조회로 미리 거르면 조회 실패 시 보강 자체가 누락돼 라운드트립에서 SUB-ACT 가 사라진다.
  // SUB-ACT 는 이미 커밋됐으므로 여기서 실패해도 액션을 되돌리지 않고 로그만 남긴다.
  const { error: parentOwnerErr } = await sb.from('item_owners').insert({ wbs_item_id: actId, team_id: teamId, kind })
  if (parentOwnerErr && parentOwnerErr.code !== '23505') {
    console.error('[addSubAct] 부모 ACT 담당 표기 보강 실패:', parentOwnerErr.message)
  }

  const { data: u } = await sb.auth.getUser()
  const { error: logInsErr } = await sb.from('change_logs').insert({ user_id: u.user?.id, wbs_item_id: newId, field: 'created', old_value: null, new_value: name })
  if (logInsErr) console.error('[addSubAct] 변경 이력 기록 실패:', logInsErr.message) // SUB-ACT 생성은 성공 — 이력만 유실
  // 첫 SUB-ACT 면 ACT 가 방금 롤업 부모가 된 것 — 직접 입력돼 있던 실적%를 정리(sibIds 는 위에서 검증된 실제 형제 목록).
  if (sibIds.length === 0) await discardRolledUpActual(sb, actId, act.project_id as string, u.user?.id)
  revalidatePath(`/p/${act.project_id}`, 'layout')
  after(() => recordProgressSnapshot(act.project_id))
  return { ok: true, id: newId }
}

/** 이름·계획일자·산출물·Biz 편집. 시작>종료 거부, 변경분만 기록. */
export async function updateWbsFields(
  itemId: string,
  fields: { name?: string; plannedStart?: string | null; plannedEnd?: string | null; deliverable?: string | null; biz?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const sb = await createServerClient()
  // 아래 patch/logs 가 이 현재값과의 diff 로 만들어진다 — 조회 실패를 '항목 없음'으로 위장하면 안 되고,
  // 빈 현재값으로 진행하면 변경 없는 필드까지 덮어쓰고 이력의 old_value 도 거짓이 된다. 실패 = 중단.
  const { data: item, error: itemErr } = await sb
    .from('wbs_items')
    .select('id, project_id, name, planned_start, planned_end, deliverable, biz')
    .eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }

  const patch: Record<string, unknown> = {}
  const logs: { field: string; old: string | null; new: string | null }[] = []
  if (fields.name !== undefined) {
    if (!fields.name.trim()) return { ok: false, error: '이름을 입력하세요' }
    if (fields.name.trim() !== item.name) { patch.name = fields.name.trim(); logs.push({ field: 'name', old: item.name, new: fields.name.trim() }) }
  }
  const ns = fields.plannedStart === undefined ? undefined : (fields.plannedStart || null)
  const ne = fields.plannedEnd === undefined ? undefined : (fields.plannedEnd || null)
  const finalStart = ns === undefined ? item.planned_start : ns
  const finalEnd = ne === undefined ? item.planned_end : ne
  if (finalStart && finalEnd && finalStart > finalEnd) return { ok: false, error: '시작일이 종료일보다 늦습니다' }
  if (ns !== undefined && ns !== item.planned_start) { patch.planned_start = ns; logs.push({ field: 'planned_start', old: item.planned_start, new: ns }) }
  if (ne !== undefined && ne !== item.planned_end) { patch.planned_end = ne; logs.push({ field: 'planned_end', old: item.planned_end, new: ne }) }
  if (fields.deliverable !== undefined) {
    const v = fields.deliverable?.trim() || null
    if (v !== item.deliverable) { patch.deliverable = v; logs.push({ field: 'deliverable', old: item.deliverable, new: v }) }
  }
  if (fields.biz !== undefined) {
    const v = fields.biz?.trim() || null
    if (v !== item.biz) { patch.biz = v; logs.push({ field: 'biz', old: item.biz, new: v }) }
  }
  if (Object.keys(patch).length === 0) return { ok: true }
  patch.updated_at = new Date().toISOString()
  const { error } = await sb.from('wbs_items').update(patch).eq('id', itemId)
  if (error) return { ok: false, error: error.message }
  const { data: u } = await sb.auth.getUser()
  if (logs.length) {
    const { error: logInsErr } = await sb.from('change_logs').insert(logs.map(l => ({ user_id: u.user?.id, wbs_item_id: itemId, field: l.field, old_value: l.old, new_value: l.new })))
    if (logInsErr) console.error('[updateWbsFields] 변경 이력 기록 실패:', logInsErr.message) // 본 저장은 성공 — 이력만 유실
  }
  revalidatePath(`/p/${item.project_id}`, 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
}

/** 산출물 텍스트만 편집 — 산출물 첨부와 동일 권한(PMO 전체, 담당팀 편집자는 자기 담당 항목만).
 *  이름·일정·구조는 거버넌스라 PMO 전용(updateWbsFields)으로 분리 유지. 진척 무관 → 스냅샷 생략. */
export async function updateDeliverable(
  itemId: string,
  deliverable: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb
    .from('wbs_items').select('id, project_id, deliverable').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  // 권한 — PMO 아니면 담당팀만(item_owners). attachments.canAttach 와 같은 판정.
  if (m.role !== 'pmo_admin') {
    const { data: own } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).eq('team_id', m.teamId).maybeSingle()
    if (!own) return { ok: false, error: '담당 작업이 아닙니다.' }
  }
  const v = deliverable?.trim() || null
  if (v === item.deliverable) return { ok: true }
  const { error } = await sb.from('wbs_items').update({ deliverable: v, updated_at: new Date().toISOString() }).eq('id', itemId)
  if (error) return { ok: false, error: error.message }
  const { data: u } = await sb.auth.getUser()
  const { error: logErr } = await sb.from('change_logs').insert({ user_id: u.user?.id, wbs_item_id: itemId, field: 'deliverable', old_value: item.deliverable, new_value: v })
  if (logErr) console.error('[updateDeliverable] 변경 이력 기록 실패:', logErr.message) // 본 저장은 성공 — 이력만 유실
  revalidatePath(`/p/${item.project_id}`, 'layout')
  return { ok: true }
}

/** 항목 삭제(하위·담당·이력 cascade). */
export async function deleteWbsItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('project_id').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${itemErr.message}` } // 삭제 전 조회 실패 = 중단
  if (!item) return { ok: false, error: '항목 없음' }
  const { error } = await sb.from('wbs_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${item.project_id as string}`, 'layout')
  after(() => recordProgressSnapshot(item.project_id as string))
  return { ok: true }
}

/** 형제 내 순서 이동(위/아래) — 인접 형제와 sort_order 교환. */
export async function moveWbsItem(itemId: string, dir: 'up' | 'down'): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('id, project_id, parent_id, sort_order').eq('id', itemId).single()
  if (itemErr && itemErr.code !== 'PGRST116') return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  let q = sb.from('wbs_items').select('id, sort_order').eq('project_id', item.project_id)
  q = item.parent_id ? q.eq('parent_id', item.parent_id) : q.is('parent_id', null)
  // 형제 조회 실패를 빈 목록으로 폴백하면 idx=-1 이 되어 "경계라 무시"(ok:true) 경로로 빠진다 —
  // 아무것도 안 하고 이동 성공으로 위장하게 되므로 실패를 그대로 알린다.
  const { data: sibs, error: sibErr } = await q.order('sort_order', { ascending: true })
  if (sibErr || !sibs) return { ok: false, error: `형제 항목 조회 실패: ${sibErr?.message ?? '알 수 없는 오류'}` }
  const arr = sibs
  const idx = arr.findIndex(s => s.id === itemId)
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1
  if (idx < 0 || swapIdx < 0 || swapIdx >= arr.length) return { ok: true } // 경계는 무시
  const a = arr[idx], b = arr[swapIdx]
  // 교환은 두 번의 update — 트랜잭션이 아니라 한쪽만 성공하면 sort_order 가 중복된 채 커밋된다.
  // .select('id') 필수: RLS 차단은 error 없이 0행으로 오므로 0행도 실패로 잡아야 한다.
  const { data: movedA, error: swapAErr } = await sb
    .from('wbs_items').update({ sort_order: b.sort_order }).eq('id', a.id).select('id')
  if (swapAErr || !movedA?.length) {
    return { ok: false, error: `순서 변경 실패: ${swapAErr?.message ?? '저장 권한이 없습니다(PMO만 가능)'}` }
  }
  const { data: movedB, error: swapBErr } = await sb
    .from('wbs_items').update({ sort_order: a.sort_order }).eq('id', b.id).select('id')
  if (swapBErr || !movedB?.length) {
    // a 만 바뀌어 두 형제의 sort_order 가 중복된 상태 — '실패'라고 알리려면 데이터도 원래대로 돌려놔야 한다.
    // 보상마저 실패하면 중복이 남으므로(정렬이 흔들림) 원인을 반드시 로그에 남긴다.
    const { data: rolledBack, error: rollbackErr } = await sb
      .from('wbs_items').update({ sort_order: a.sort_order }).eq('id', a.id).select('id')
    if (rollbackErr || !rolledBack?.length) {
      console.error(
        `[moveWbsItem] 보상 롤백 실패 — sort_order 중복 잔존(item=${a.id}, sort_order=${String(b.sort_order)}):`,
        rollbackErr?.message ?? '0행(RLS 차단 추정)',
      )
    }
    return { ok: false, error: `순서 변경 실패: ${swapBErr?.message ?? '저장 권한이 없습니다(PMO만 가능)'}` }
  }
  revalidatePath(`/p/${item.project_id as string}`, 'layout')
  return { ok: true }
}
