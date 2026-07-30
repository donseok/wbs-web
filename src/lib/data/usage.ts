import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActor } from '@/lib/authz'
import { canViewUsage } from '@/lib/authz/usageAccess'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  USAGE_RETAIN_DAYS, addDaysIso,
  type AccountRecord, type DailyActive, type MenuRank, type UsageSummary, type UserRollup,
} from '@/lib/domain/usage'

export interface UsageEventRow {
  id: number
  userId: string
  menuKey: string
  path: string
  occurredAt: string
}

/** KST 일자 경계를 timestamptz 문자열로. RPC 의 범위 조건과 같은 기준을 쓴다. */
function kstStart(dateIso: string): string {
  return `${dateIso}T00:00:00+09:00`
}

export async function getUsageSummary(from: string, to: string, today: string): Promise<UsageSummary> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_summary', { p_from: from, p_to: to, p_today: today })
  // 요약 실패를 0으로 표시하면 '아무도 안 썼다'와 '집계가 깨졌다'가 화면에서 같아 보인다.
  if (error) throw new Error('사용 현황 요약을 불러오지 못했습니다: ' + error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return {
    totalEvents: Number(row?.total_events ?? 0),
    activeUsers: Number(row?.active_users ?? 0),
    todayUsers: Number(row?.today_users ?? 0),
    lastEventAt: (row?.last_event_at as string | null) ?? null,
  }
}

export async function getDailyActives(from: string, to: string): Promise<DailyActive[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_daily_actives', { p_from: from, p_to: to })
  if (error) throw new Error('일별 활성 사용자를 불러오지 못했습니다: ' + error.message)
  return ((data as Record<string, unknown>[] | null) ?? []).map(r => ({
    d: r.d as string,
    activeUsers: Number(r.active_users),
    events: Number(r.events),
  }))
}

export async function getMenuRanking(from: string, to: string): Promise<MenuRank[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_menu_ranking', { p_from: from, p_to: to })
  if (error) throw new Error('메뉴 사용량을 불러오지 못했습니다: ' + error.message)
  return ((data as Record<string, unknown>[] | null) ?? []).map(r => ({
    menuKey: r.menu_key as string,
    events: Number(r.events),
    activeUsers: Number(r.active_users),
  }))
}

export async function getUserRollup(from: string, to: string): Promise<UserRollup[]> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_user_rollup', { p_from: from, p_to: to })
  if (error) throw new Error('사용자별 활동을 불러오지 못했습니다: ' + error.message)
  return ((data as Record<string, unknown>[] | null) ?? []).map(r => ({
    userId: r.user_id as string,
    events: Number(r.events),
    activeDays: Number(r.active_days),
    lastAt: (r.last_at as string | null) ?? null,
  }))
}

/**
 * 접속 횟수 — 무활동 간격으로 유도한 값(로그인이 서버에 기록되지 않는다).
 * 반드시 사용자별로 끊어야 하므로 SQL 의 lag() 로 계산한다. 표시용 로그 200건이 아니라
 * 기간 전체가 대상이라 다른 KPI 와 같은 축이다.
 */
export async function getUsageSessions(from: string, to: string, gapMinutes: number): Promise<number> {
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('usage_sessions', {
    p_from: from, p_to: to, p_gap_minutes: gapMinutes,
  })
  if (error) throw new Error('접속 횟수를 불러오지 못했습니다: ' + error.message)
  return Number(data ?? 0)
}

export async function getRecentUsageEvents(o: {
  from: string; to: string; userId?: string; menuKey?: string; limit: number
}): Promise<UsageEventRow[]> {
  const sb = await createServerClient()
  let q = sb
    .from('usage_events')
    .select('id, user_id, menu_key, path, occurred_at')
    .gte('occurred_at', kstStart(o.from))
    .lt('occurred_at', kstStart(addDaysIso(o.to, 1)))
    .order('occurred_at', { ascending: false })
    .limit(o.limit)
  if (o.userId) q = q.eq('user_id', o.userId)
  if (o.menuKey) q = q.eq('menu_key', o.menuKey)

  const { data, error } = await q
  if (error) throw new Error('접속 로그를 불러오지 못했습니다: ' + error.message)
  return ((data as Record<string, unknown>[] | null) ?? []).map(r => ({
    id: Number(r.id),
    userId: r.user_id as string,
    menuKey: r.menu_key as string,
    path: r.path as string,
    occurredAt: r.occurred_at as string,
  }))
}

/**
 * 계정 디렉터리 — auth.users + memberships/teams.
 *
 * service_role 로 auth.users 를 읽으므로 이 함수 자체가 게이트를 다시 검사한다(fail-closed).
 * 화면의 redirect 는 UX 이고, 실제 방어선은 여기다.
 * last_sign_in_at 은 GoTrue 가 계속 채워온 값이라 수집 시작 이전까지 소급되는 유일한 데이터다.
 */
export async function getUsageDirectory(): Promise<AccountRecord[]> {
  if (!canViewUsage(await getActor())) {
    throw new Error('사용 현황을 볼 권한이 없습니다.')
  }
  const admin = createAdminClient()

  type Raw = {
    id: string
    email: string
    created_at: string
    last_sign_in_at: string | null
    meta: Record<string, unknown>
  }
  const users: Raw[] = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    // 지금까지 모은 페이지만 반환하면 '잘린 목록'이 완전한 목록처럼 보인다 —
    // 빠진 계정은 '한 번도 안 들어온 사람'과 구별되지 않는다. listAccounts 와 같은 fail-loud.
    if (error || !data) {
      throw new Error(`계정 목록을 불러오지 못했습니다(page=${page}): ${error?.message ?? 'unknown'}`)
    }
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? '',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        meta: (u.user_metadata ?? {}) as Record<string, unknown>,
      })
    }
    if (data.users.length < perPage) break
  }

  const { data: mems, error: memsErr } = await admin
    .from('memberships')
    .select('user_id, role, teams(code)')
  // 조회 실패를 '멤버십 없음'으로 폴백하면 전원이 '팀 없음/권한 없음'으로 렌더링된다.
  if (memsErr || !mems) {
    throw new Error('계정 권한 정보를 불러오지 못했습니다: ' + (memsErr?.message ?? 'unknown'))
  }
  const byUser = new Map<string, { role: string; teamCode: string | null }>()
  for (const row of mems as unknown as Record<string, unknown>[]) {
    const team = row.teams as { code: string } | null
    byUser.set(row.user_id as string, { role: row.role as string, teamCode: team?.code ?? null })
  }

  return users.map<AccountRecord>(u => ({
    id: u.id,
    email: u.email,
    name: displayNameFrom(u.meta, u.email) ?? u.email,
    teamCode: byUser.get(u.id)?.teamCode ?? null,
    role: byUser.get(u.id)?.role ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at,
  }))
}

/**
 * 보존 기간 정리 — /usage 렌더의 after() 에서 호출한다("조회가 쓰기를 유발"하는
 * recordProgressSnapshot 선례와 동형). 크론 슬롯은 wiki worker 가 이미 쓰고 있고
 * 이 정리는 지연에 민감하지 않다.
 *
 * 쿨다운 상태가 인스턴스 메모리라 서버리스 다중 인스턴스에서 완전 직렬화되지 않는다 —
 * 최악은 삭제 쿼리 중복 실행이며 멱등이므로 수용한다(createEnsureGate 와 같은 판단).
 * 정리 실패가 화면을 깨면 안 되므로 절대 throw 하지 않되, 반드시 로그로 남긴다.
 */
let lastPurgeAt = 0
const PURGE_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function purgeOldUsageEvents(): Promise<void> {
  if (Date.now() - lastPurgeAt < PURGE_COOLDOWN_MS) return
  lastPurgeAt = Date.now()
  try {
    const cutoff = new Date(Date.now() - USAGE_RETAIN_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const admin = createAdminClient()
    const { error } = await admin.from('usage_events').delete().lt('occurred_at', cutoff)
    if (error) console.error('[usage] 보존기간 정리 실패:', error.message)
  } catch (e) {
    console.error('[usage] 보존기간 정리 예외:', e instanceof Error ? e.message : e)
  }
}
