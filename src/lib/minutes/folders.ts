import type { createServerClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import { MINUTE_FOLDER_DEPTH_MAX } from '@/lib/domain/minutes'
import { parseFolderPathValue } from '@/lib/minutes/externalApi'
import type { TeamCode } from '@/lib/domain/types'

type DbClient = Awaited<ReturnType<typeof createServerClient>> | ReturnType<typeof createAdminClient>

/** 담당 팀과 동명인 **시드** 루트 폴더 id — 신규 회의록 자동 편철용(0043 하이어라키: 루트=팀코드 5축).
 *  created_by null(시드) 고정 — 동명 사용자 폴더(스쿼팅)가 전사 편철 대상이 되면 안 됨.
 *  조회 실패·폴더 부재는 null(미분류 폴백)로 로그만 남긴다 — 편철이 등록 자체를 막으면 안 됨. */
export async function resolveTeamRootFolderId(
  sb: DbClient, teamCode: TeamCode,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).eq('name', teamCode).maybeSingle()
  if (error) {
    console.error('[minutes] 팀 루트 폴더 조회 실패(미분류 폴백):', error.message)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}

/** 폴더 id → root-first 경로명. 응답 에코(§3.3)를 **항상 진실되게** 유지하기 위한 역해석 —
 *  folder_path 를 받지 않은 재전송(구버전 또박또박)·skip 응답에서도 현재 위치를 알려준다.
 *  미분류(null)·조회 실패·끊긴 체인은 null. 순환은 가드로 끊는다. */
export async function folderPathOf(
  sb: DbClient, folderId: string | null,
): Promise<string[] | null> {
  if (!folderId) return null
  const { data, error } = await sb.from('minute_folders').select('id, name, parent_id')
  if (error) {
    console.error('[minutes] 폴더 경로 역해석 실패(에코 생략):', error.message)
    return null
  }
  const byId = new Map<string, { name: string; parentId: string | null }>()
  for (const r of (data ?? []) as Array<{ id: string; name: string; parent_id: string | null }>) {
    byId.set(r.id, { name: r.name, parentId: r.parent_id })
  }
  const out: string[] = []
  const seen = new Set<string>()
  let cur: string | null = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const node = byId.get(cur)
    if (!node) return null                       // 끊긴 체인 — 추측하지 않는다
    out.unshift(node.name)
    cur = node.parentId
  }
  return out.length > 0 ? out : null
}

/* ── folder_path 편철 (계약 v2.3 §3.2) ───────────────────────────────────────── */

export type FolderPathNormalized =
  | { ok: true; path: string[]; truncated: boolean }
  | { ok: false; error: string; reason: string }

/**
 * §3.2 정규화 — 또박또박 폴더 구조는 자유라 루트명이 팀코드가 아닐 수 있다.
 *
 *   ① path[0] === team              → path 그대로
 *   ② path[0] ∉ 활성 팀코드          → [team, ...path] (한 칸 내림)
 *   ③ path[0] ∈ 활성 팀코드(타 팀)    → 거절
 *   ④ 정규화 후 깊이 5 초과분은 절단
 *
 * 결과 경로의 **첫 세그먼트는 항상 teamCode** 다 — 외부 API 는 루트를 만들지 않는다(C2).
 *
 * ⚠️ ①에 팀코드 캐시 조회를 넣지 말 것. path[0] === team 이면 그 팀 루트로 편철하는 것이
 *    정의상 맞고, 넣으면 해롭다: 관리자가 팀을 비활성화하면 team_code='MDM' 인 기존 전송분의
 *    배치 재편철이 ①에서 탈락해 ②로 떨어져 ["MDM","MDM","품질"]처럼 루트 세그먼트가
 *    중복된다. minute_folders_child_name_uniq 는 부분 인덱스라 이를 막지 못한다(C3).
 *
 * ⚠️ 캐시 stale 시 degrade 방향을 뒤집지 말 것 — 캐시에 없는 값은 ②(자유 폴더 취급)로
 *    빠지지 ③(거절)으로 가지 않는다. "모르는 값은 거절"이 아니라 "모르는 값은 자유 폴더".
 */
export function normalizeFolderPath(
  teamCode: TeamCode,
  path: readonly string[],
  activeTeamCodes: readonly string[],
): FolderPathNormalized {
  // [] = 명시적 '폴더 없음' → 팀 루트. 키 부재(=기존 위치 유지)와는 호출부가 구분한다.
  if (path.length === 0) return { ok: true, path: [teamCode], truncated: false }

  let normalized: string[]
  if (path[0] === teamCode) {
    normalized = [...path]                                   // ① 단독 조건 — 캐시 무관
  } else if (!activeTeamCodes.includes(path[0])) {
    normalized = [teamCode, ...path]                         // ② 한 칸 내림
  } else {
    // ③ 조용히 한쪽을 따르면 목록 필터(?team=)와 폴더 위치가 어긋난다
    return {
      ok: false,
      error: `folder_path의 최상위 '${path[0]}'가 담당 '${teamCode}'와 다른 팀입니다.`,
      reason: `validation_failed: folder_path 최상위가 다른 팀(${path[0]})입니다.`,
    }
  }

  const truncated = normalized.length > MINUTE_FOLDER_DEPTH_MAX
  return {
    ok: true,
    path: truncated ? normalized.slice(0, MINUTE_FOLDER_DEPTH_MAX) : normalized,
    truncated,
  }
}

export type ResolveFolderPathResult =
  | {
      ok: true
      folderId: string
      /** 실제 편철 결과 — 절단·한 칸 내림이 반영된 경로. 응답 에코(§3.3)의 원천. */
      resolvedPath: string[]
      /** 깊이 5 초과로 절단됐는가(§3.2-4). */
      truncated: boolean
      /**
       * 하위 폴더 조회·생성이 중간에 실패해 **조상까지만** 편철됐는가.
       * 등록(POST /minutes)은 그대로 진행한다(편철 실패가 등록을 막으면 안 됨).
       * 배치(§8)는 이동 도구이므로 failed 로 보고한다 — 호출자가 정한다.
       */
      partial: boolean
    }
  | {
      ok: false
      /** no_team_root = §3.2-5 시드 루트 부재. 처리는 호출자가 정한다(등록=미분류 폴백 / 배치=failed). */
      kind: 'no_team_root' | 'validation_failed'
      /** POST /minutes 400 본문용 한국어 메시지. */
      error: string
      /** 배치 응답 results[].reason 문자열(§8.2 요건 11). */
      reason: string
    }

/** 부모 아래 자식 폴더 확보 — 없으면 생성. 실패는 null(호출부가 partial 로 흡수).
 *
 *  C3: minute_folders_child_name_uniq 는 부분 인덱스(where parent_id is not null)라
 *  ON CONFLICT 가 conflict 대상 추론에 실패해 42P10 이 된다. 그래서 insert → 23505 면
 *  재조회로 동시 전송 경합을 흡수한다(minutes upsert 가 쓰는 것과 같은 우회).
 *  C4: created_by 는 전송 사용자 id — null 은 **시드 표식**이라 스쿼팅 방어와 0043 재실행이
 *  이 값으로 시드를 식별한다. */
async function ensureChildFolder(
  sb: DbClient, parentId: string, name: string, actorId: string,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .insert({ name, parent_id: parentId, created_by: actorId })
    .select('id').single()
  if (!error && data) return (data as { id: string }).id
  if (error?.code === '23505') {
    const { data: raced, error: reErr } = await sb.from('minute_folders')
      .select('id').eq('parent_id', parentId).eq('name', name).maybeSingle()
    if (!reErr && raced) return (raced as { id: string }).id
    console.error(`[minutes] 폴더 경합 재조회 실패(${name}):`, reErr?.message ?? 'no row')
    return null
  }
  console.error(`[minutes] 폴더 생성 실패(${name}):`, error?.message ?? 'no row')
  return null
}

/**
 * folder_path → 편철 대상 폴더 id (§3.2). 팀 루트 아래에 같은 폴더 트리를 만들어 편철한다.
 *
 * POST /minutes(등록)와 POST /minutes/folder(배치 재편철)가 **공유**한다 — 별도 구현을 만들면
 * 마이그레이션 결과와 이후 전송 결과가 어긋난다(§8.2 요건 1).
 *
 * ⚠️ teamCode 는 **필수·구체값**이다. 배치의 items[].team 이 선택인 것은 배치 라우트의 책임 —
 *    라우트가 먼저 team 을 확정한 뒤 확정값으로 이 함수를 부른다. 여기에 teamCode 옵션 분기를
 *    만들지 말 것(두 번째 정규화 구현이 생기는 통로다).
 *
 * 조회는 한 번에 하고 부족분만 순차 생성한다 — 깊은 경로에서 왕복을 최소화.
 */
export async function resolveFolderPath(
  sb: DbClient,
  teamCode: TeamCode,
  path: readonly string[],
  opts: { actorId: string; activeTeamCodes: readonly string[] },
): Promise<ResolveFolderPathResult> {
  const parsed = parseFolderPathValue(path)
  if (!parsed.ok) return { ok: false, kind: 'validation_failed', error: parsed.error, reason: parsed.reason }
  const norm = normalizeFolderPath(teamCode, parsed.path, opts.activeTeamCodes)
  if (!norm.ok) return { ok: false, kind: 'validation_failed', error: norm.error, reason: norm.reason }

  const rootId = await resolveTeamRootFolderId(sb, teamCode)
  if (!rootId) {
    // §3.2-5. 원인은 거의 항상 0043 미적용이다.
    return {
      ok: false,
      kind: 'no_team_root',
      error: `담당 '${teamCode}'의 기본 폴더가 없습니다.`,
      reason: 'no_team_root',
    }
  }

  const rest = norm.path.slice(1)
  const resolvedPath = [norm.path[0]]
  if (rest.length === 0) {
    return { ok: true, folderId: rootId, resolvedPath, truncated: norm.truncated, partial: false }
  }

  // 한 번에 조회 — 이름 집합으로 긁어 (parent_id, name) 으로 걸어 내려간다. 동명 폴더가 여러
  // 부모 아래 있어도 parent_id 로 갈리므로 안전하다.
  const { data, error } = await sb.from('minute_folders')
    .select('id, name, parent_id').in('name', Array.from(new Set(rest)))
  if (error) {
    console.error('[minutes] 하위 폴더 조회 실패(팀 루트까지만 편철):', error.message)
    return { ok: true, folderId: rootId, resolvedPath, truncated: norm.truncated, partial: true }
  }
  const byParentName = new Map<string, string>()
  for (const r of (data ?? []) as Array<{ id: string; name: string; parent_id: string | null }>) {
    byParentName.set(`${r.parent_id ?? ''} ${r.name}`, r.id)
  }

  let cur = rootId
  for (const name of rest) {
    const hit = byParentName.get(`${cur} ${name}`)
    if (hit) { cur = hit; resolvedPath.push(name); continue }
    const created = await ensureChildFolder(sb, cur, name, opts.actorId)
    if (!created) {
      return { ok: true, folderId: cur, resolvedPath, truncated: norm.truncated, partial: true }
    }
    cur = created
    resolvedPath.push(name)
  }
  return { ok: true, folderId: cur, resolvedPath, truncated: norm.truncated, partial: false }
}
