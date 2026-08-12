import type { createServerClient } from '@/lib/supabase/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import { MINUTE_FOLDER_DEPTH_MAX } from '@/lib/domain/minutes'
import { parseFolderPathValue } from '@/lib/minutes/externalApi'
import type { TeamCode } from '@/lib/domain/types'

type DbClient = Awaited<ReturnType<typeof createServerClient>> | ReturnType<typeof createAdminClient>

/** 담당 팀과 동명인 **시드** 루트 폴더 id — 신규 회의록 자동 편철용(0043 하이어라키: 루트=팀코드 5축).
 *  created_by null(시드) 고정 — 동명 사용자 폴더(스쿼팅)가 전사 편철 대상이 되면 안 됨.
 *  조회 실패·폴더 부재는 null(미분류 폴백)로 로그만 남긴다 — 편철이 등록 자체를 막으면 안 됨.
 *  folder_path 미전송(구버전 또박또박) 경로의 폴백으로 존치한다.
 *  projectId(0076) — null 은 미지정(전역) 트리, uuid 는 그 프로젝트 전용 트리의 루트다. */
export async function resolveTeamRootFolderId(
  sb: DbClient, teamCode: TeamCode, projectId: string | null,
): Promise<string | null> {
  let q = sb.from('minute_folders')
    .select('id').is('parent_id', null).is('created_by', null).eq('name', teamCode)
  q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
  const { data, error } = await q.maybeSingle()
  if (error) {
    console.error('[minutes] 팀 루트 폴더 조회 실패(미분류 폴백):', error.message)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}

/* ── 폴더 스냅샷 ─────────────────────────────────────────────────────────────
 * minute_folders 는 작은 테이블이라 한 번에 읽어 인메모리로 걸어 다니는 편이
 * 경로 해석(N단 왕복)·역해석·배치 재편철(200건) 모두에서 압도적으로 싸다.
 * actions/minutes.ts 의 loadFolders 도 같은 전략이다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FolderRow {
  id: string
  name: string
  parentId: string | null
  createdBy: string | null
  projectId: string | null   // 0076: null = 미지정 영역
}

export interface FolderSnapshot {
  byId: Map<string, FolderRow>
  /** `${parentId} ${name}` → id. parentId 는 uuid(공백 없음)라 구분자 충돌이 없다. */
  byParentName: Map<string, string>
  /** 시드 루트(parent_id null · created_by null) `rootKey(projectId, name)` → id.
   *  (프로젝트, 팀코드) 로 분리돼 동명 루트가 프로젝트별로 공존한다(0076). */
  seedRoots: Map<string, string>
}

const childKey = (parentId: string, name: string) => `${parentId} ${name}`

/** seedRoots 키 — projectId 는 uuid(공백 없음), 미지정은 '-'. */
const rootKey = (projectId: string | null, name: string) => `${projectId ?? '-'} ${name}`

export function buildFolderSnapshot(rows: readonly FolderRow[]): FolderSnapshot {
  const snap: FolderSnapshot = { byId: new Map(), byParentName: new Map(), seedRoots: new Map() }
  for (const r of rows) addToFolderSnapshot(snap, r)
  return snap
}

export function addToFolderSnapshot(snap: FolderSnapshot, row: FolderRow): void {
  snap.byId.set(row.id, row)
  if (row.parentId === null) {
    if (row.createdBy === null) snap.seedRoots.set(rootKey(row.projectId, row.name), row.id)
  } else {
    snap.byParentName.set(childKey(row.parentId, row.name), row.id)
  }
}

/** 전량 로드. 실패는 null(fail-loud 로그) — 호출부가 '폴더 없음'과 구분해 처리한다. */
export async function loadFolderSnapshot(sb: DbClient): Promise<FolderSnapshot | null> {
  const { data, error } = await sb.from('minute_folders')
    .select('id, name, parent_id, created_by, project_id')
  if (error) {
    console.error('[minutes] 폴더 스냅샷 로드 실패:', error.message)
    return null
  }
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string,
    name: r.name as string,
    parentId: (r.parent_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
  }))
  return buildFolderSnapshot(rows)
}

/** 폴더 id → root-first 경로명. 미분류(null)·끊긴 체인은 null. 순환은 가드로 끊는다. */
export function folderPathOfSnapshot(
  snap: FolderSnapshot, folderId: string | null,
): string[] | null {
  if (!folderId) return null
  const out: string[] = []
  const seen = new Set<string>()
  let cur: string | null = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const node = snap.byId.get(cur)
    if (!node) return null                       // 끊긴 체인 — 추측하지 않는다
    out.unshift(node.name)
    cur = node.parentId
  }
  return out.length > 0 ? out : null
}

/** folderId 와 그 조상 전부의 id 집합(자기 자신 포함). 순환·끊긴 체인은 거기서 끊는다.
 *  배치의 **조상 규칙**(결정 §2-J) 판정용 — 현재 위치가 목표 경로의 조상이면 더 깊게 넣는 것이
 *  사람의 정리를 훼손하지 않으므로 이동한다. */
export function ancestorIdsOf(snap: FolderSnapshot, folderId: string | null): Set<string> {
  const out = new Set<string>()
  let cur: string | null = folderId
  while (cur && !out.has(cur)) {
    out.add(cur)
    cur = snap.byId.get(cur)?.parentId ?? null
  }
  return out
}

/** 응답 에코(§3.3)용 역해석 단건 — folder_path 를 받지 않은 재전송·skip 응답에서 쓴다. */
export async function folderPathOf(
  sb: DbClient, folderId: string | null,
): Promise<string[] | null> {
  if (!folderId) return null
  const snap = await loadFolderSnapshot(sb)
  return snap ? folderPathOfSnapshot(snap, folderId) : null
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
      /** 확보된 폴더 id. complete 가 false 면 목표 경로의 **조상**이다. */
      folderId: string
      /** folderId 가 실제로 있는 경로 — 등록 응답 에코(§3.3)는 **이것**을 쓴다(진실된 위치). */
      resolvedPath: string[]
      /** 목표 경로 전체 — 절단·한 칸 내림이 반영된 결과. 배치의 `to` 는 이것을 쓴다. */
      targetPath: string[]
      /** folderId 가 targetPath 의 끝인가. */
      complete: boolean
      /** complete 가 false 인 이유가 **생성 실패**인가(false = dry run 미생성). */
      failed: boolean
      /** 깊이 5 초과로 절단됐는가(§3.2-4). */
      truncated: boolean
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

/** 부모 아래 자식 폴더 생성 — 실패는 null(호출부가 흡수).
 *
 *  C3: minute_folders_child_name_uniq 는 부분 인덱스(where parent_id is not null)라
 *  ON CONFLICT 가 conflict 대상 추론에 실패해 42P10 이 된다. 그래서 insert → 23505 면
 *  재조회로 동시 전송 경합을 흡수한다(minutes upsert 가 쓰는 것과 같은 우회).
 *  C4: created_by 는 전송 사용자 id — null 은 **시드 표식**이라 스쿼팅 방어와 0043 재실행이
 *  이 값으로 시드를 식별한다.
 *  projectId(0076) — 부모와 같은 프로젝트(자식 project_id = 부모 project_id 불변식). */
async function createChildFolder(
  sb: DbClient, parentId: string, name: string, actorId: string, projectId: string | null,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .insert({ name, parent_id: parentId, created_by: actorId, project_id: projectId })
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

/** 프로젝트 팀 루트 지연 보장 — 시드(created_by null) 삽입이라 **admin 클라이언트 필수**
 *  (0040 RLS insert 정책은 created_by = auth.uid() 를 요구한다). 23505 는 동시 생성 경합 —
 *  createChildFolder 와 같은 재조회 우회. 실패는 null(호출부 미분류 폴백). */
export async function ensureProjectTeamRoot(
  sb: DbClient, projectId: string, teamCode: TeamCode,
): Promise<string | null> {
  const { data, error } = await sb.from('minute_folders')
    .insert({ name: teamCode, parent_id: null, created_by: null, project_id: projectId })
    .select('id').single()
  if (!error && data) return (data as { id: string }).id
  if (error?.code === '23505') {
    const { data: raced, error: reErr } = await sb.from('minute_folders')
      .select('id').is('parent_id', null).is('created_by', null)
      .eq('name', teamCode).eq('project_id', projectId).maybeSingle()
    if (!reErr && raced) return (raced as { id: string }).id
  }
  console.error(`[minutes] 프로젝트 팀 루트 생성 실패(${teamCode}):`, error?.message ?? 'no row')
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
 */
export async function resolveFolderPath(
  sb: DbClient,
  teamCode: TeamCode,
  path: readonly string[],
  opts: {
    actorId: string
    activeTeamCodes: readonly string[]
    /** 배치가 미리 읽어 둔 스냅샷 — 항목당 왕복을 없앤다. 생성분은 여기 반영돼 다음 항목이 재사용한다. */
    snapshot?: FolderSnapshot
    /** false = 폴더를 만들지 않는다(dry run). 없는 경로는 complete:false·failed:false 로 보고. */
    create?: boolean
    /** 0076 — null 은 미지정(전역) 트리, uuid 는 그 프로젝트 전용 트리. 필수라 전 호출부가
     *  스코프를 명시하게 강제한다. */
    projectId: string | null
  },
): Promise<ResolveFolderPathResult> {
  const parsed = parseFolderPathValue(path)
  if (!parsed.ok) return { ok: false, kind: 'validation_failed', error: parsed.error, reason: parsed.reason }
  const norm = normalizeFolderPath(teamCode, parsed.path, opts.activeTeamCodes)
  if (!norm.ok) return { ok: false, kind: 'validation_failed', error: norm.error, reason: norm.reason }

  const snap = opts.snapshot ?? await loadFolderSnapshot(sb)
  const rootId0 = snap?.seedRoots.get(rootKey(opts.projectId, teamCode)) ?? null
  let rootId = rootId0
  // snap 을 앞세운다 — loadFolderSnapshot 실패(null)면 조회 자체가 실패한 것이라 지연 생성도
  // 하지 않는다(쓰기 전 선행 조회 실패는 중단). snap 이 있어야만 아래 addToFolderSnapshot(snap, …)
  // 의 "rootId 가 있으면 snap 도 있다" 불변식이 성립한다.
  if (snap && !rootId && opts.projectId && opts.create !== false
    && opts.activeTeamCodes.includes(teamCode)) {
    rootId = await ensureProjectTeamRoot(sb, opts.projectId, teamCode)
    if (rootId) {
      addToFolderSnapshot(snap, {
        id: rootId, name: teamCode, parentId: null, createdBy: null, projectId: opts.projectId,
      })
    }
  }
  if (!rootId) {
    // §3.2-5. 원인은 거의 항상 0043 미적용이다(스냅샷 로드 실패면 위에서 이미 로그가 남는다).
    return {
      ok: false,
      kind: 'no_team_root',
      error: `담당 '${teamCode}'의 기본 폴더가 없습니다.`,
      reason: 'no_team_root',
    }
  }

  const create = opts.create !== false
  const base = { targetPath: norm.path, truncated: norm.truncated } as const
  let cur = rootId
  const resolvedPath = [norm.path[0]]
  for (const name of norm.path.slice(1)) {
    const hit = snap!.byParentName.get(childKey(cur, name))
    if (hit) { cur = hit; resolvedPath.push(name); continue }
    // dry run — 만들지 않고 "여기까지만 실재한다"를 보고한다(쓰기 0).
    if (!create) return { ok: true, ...base, folderId: cur, resolvedPath, complete: false, failed: false }
    const created = await createChildFolder(sb, cur, name, opts.actorId, opts.projectId)
    // 생성 실패는 조상까지만 편철 — 등록 자체를 막지 않는다. 배치는 이걸 failed 로 읽는다.
    if (!created) return { ok: true, ...base, folderId: cur, resolvedPath, complete: false, failed: true }
    addToFolderSnapshot(snap!, {
      id: created, name, parentId: cur, createdBy: opts.actorId, projectId: opts.projectId,
    })
    cur = created
    resolvedPath.push(name)
  }
  return { ok: true, ...base, folderId: cur, resolvedPath, complete: true, failed: false }
}
