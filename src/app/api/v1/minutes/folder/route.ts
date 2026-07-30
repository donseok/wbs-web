import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { activeTeamCodesSync } from '@/lib/teams/master'
import {
  ancestorIdsOf, folderPathOfSnapshot, loadFolderSnapshot, resolveFolderPath, type FolderSnapshot,
} from '@/lib/minutes/folders'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, EXTERNAL_ID_MAX,
  gateMinutesApi, parseFolderPathValue, parseUserEmail, resolveUserByEmail, isBatchAuthorized,
  type AdminClient,
} from '@/lib/minutes/externalApi'

/**
 * POST /api/v1/minutes/folder — 이미 전송된 회의록의 **일괄 재편철**. 계약 §4c(작업지시 §8).
 *
 * 왜 재전송(`on_conflict=replace`)으로 하지 않는가: commit_minute_body_version 은 본문이 같아도
 * 무조건 새 버전을 append 하고, 후처리(rematch·ingest·insights)가 전건 재실행돼 LLM 호출이
 * 폭주한다. 사용자에게는 "전 회의록이 어제 수정됨"으로 보인다. 반면 폴더만 바꾸는 것은
 * v_index_content_changed 대상이 아니라 위키 재빌드도 걸리지 않는 **지극히 싼 연산**이다.
 *
 * 그래서 이 라우트는 (1) 버전을 append 하지 않고 (2) updated_at 을 갱신하지 않는다.
 */

export const dynamic = 'force-dynamic'
/** 200건 × (해석 + update) — 기본 10s 로는 부족할 수 있다. */
export const maxDuration = 60

const ITEMS_MAX = 200

type ItemStatus = 'moved' | 'already_correct' | 'skipped' | 'not_found' | 'failed'

interface BatchItem {
  externalId: string
  /** 선택 — 생략하면 회의록의 기존 team_code 를 쓴다. 또박또박은 전송 당시 team 을 기록하지 않는다. */
  team: string | null
  folderPath: string[]
  /**
   * 건별 검증 실패 사유(§4c.4-7). **요청 전체를 400 으로 떨구지 않는다** — 200건 중 1건의
   * folder_path 오타로 나머지 199건이 함께 죽으면 부분 실패 불가 계약과 어긋난다.
   */
  parseError?: string
}

/**
 * 편철 품질 신호(결정 §2-C). 짧아진 경로를 만드는 원인이 3개라 boolean 하나로는 오독이 는다.
 * 또박또박이 스스로 판정하려면 정규화 규칙 ①②③ + 활성 팀코드 캐시를 Ruby 에 재구현해야 하는데,
 * 그건 계약이 서버에 금지한 '두 번째 정규화 구현'을 클라이언트에 강요하는 셈이다.
 */
type FolderPathStatus =
  /** 정규화 결과 그대로 편철(한 칸 내림 포함 — 정상 동작). */
  | 'exact'
  /** 깊이 5 초과로 절단. 조상 폴더에 들어가므로 해상도 저하이지 위조는 아니다. */
  | 'truncated'
  /** 중간 폴더 생성 실패로 조상까지만 편철. 종전에는 완전히 침묵하던 경로. */
  | 'partial'
  /** 시드 팀 루트 부재로 미분류. */
  | 'unclassified'

interface ItemResult {
  external_id: string
  status: ItemStatus
  reason?: string
  /** 이동 전 위치. **미분류였으면 null** — 계약 예시가 전부 배열이라 별도 명시가 필요하다(§2-D). */
  from?: string[] | null
  to?: string[]
  folder_id?: string | null
  folder_path_status?: FolderPathStatus
}

interface ParsedBatch {
  dryRun: boolean
  overwriteManual: boolean
  items: BatchItem[]
}

/** 봉투(envelope) 검증만 400 으로 돌린다. 건별 사유(folder_path·team)는 results[].failed 로 보고한다. */
function parseBatchPayload(raw: unknown): { batch: ParsedBatch } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: '잘못된 요청입니다.' }
  const b = raw as Record<string, unknown>

  // 기본 true — 필드 부재 = dry run. 실제 이동은 명시적 false 를 요구한다(요건 8).
  let dryRun = true
  if (b.dry_run !== undefined) {
    if (typeof b.dry_run !== 'boolean') return { error: 'dry_run은 boolean이어야 합니다.' }
    dryRun = b.dry_run
  }
  let overwriteManual = false
  if (b.overwrite_manual !== undefined) {
    if (typeof b.overwrite_manual !== 'boolean') return { error: 'overwrite_manual은 boolean이어야 합니다.' }
    overwriteManual = b.overwrite_manual
  }

  if (!Array.isArray(b.items)) return { error: 'items는 배열이어야 합니다.' }
  if (b.items.length > ITEMS_MAX) return { error: `items는 ${ITEMS_MAX}건 이하여야 합니다.` }

  const items: BatchItem[] = []
  for (const raw2 of b.items) {
    if (typeof raw2 !== 'object' || raw2 === null) return { error: 'items의 각 원소는 객체여야 합니다.' }
    const it = raw2 as Record<string, unknown>
    // external_id 는 건별 보고의 키다 — 없으면 어느 건이 실패했는지 말할 수 없으므로 봉투 오류로 본다.
    const externalId = typeof it.external_id === 'string' ? it.external_id.trim() : ''
    if (!externalId) return { error: 'items[].external_id가 필요합니다.' }
    if (externalId.length > EXTERNAL_ID_MAX) {
      return { error: `items[].external_id는 ${EXTERNAL_ID_MAX}자 이하여야 합니다.` }
    }
    // 아래부터는 **건별** 검증이다 — 200건 중 1건의 오타로 나머지가 함께 죽으면 안 된다(§4c.4-7).
    let team: string | null = null
    let parseError: string | undefined
    if (it.team !== undefined && it.team !== null) {
      if (typeof it.team !== 'string' || !it.team.trim()) parseError = 'validation_failed: items[].team이 올바르지 않습니다.'
      else team = it.team.trim()
    }
    const rawPath = it.folder_path
    if (!parseError) {
      const parsed = parseFolderPathValue(rawPath)
      if (!parsed.ok) parseError = parsed.reason
    }
    items.push({
      externalId, team,
      folderPath: Array.isArray(rawPath) ? (rawPath as string[]) : [],
      ...(parseError ? { parseError } : {}),
    })
  }
  return { batch: { dryRun, overwriteManual, items } }
}

interface MinuteRow {
  id: string
  external_id: string
  team_code: string
  folder_id: string | null
  archived_at: string | null
}

/** 편철 품질 신호(§2-C) — 심각한 쪽부터 판정한다. */
function folderPathStatusOf(
  args: { folderId: string | null; truncated: boolean; failed: boolean },
): FolderPathStatus {
  if (args.folderId === null) return 'unclassified'
  if (args.failed) return 'partial'
  if (args.truncated) return 'truncated'
  return 'exact'
}

/** 회의록 한 건의 재편철 판정 + 실행. 부분 실패는 전체를 롤백하지 않는다(요건 7). */
async function processItem(
  admin: AdminClient,
  item: BatchItem,
  row: MinuteRow | undefined,
  snap: FolderSnapshot,
  batch: ParsedBatch,
  actorId: string,
  activeTeamCodes: readonly string[],
): Promise<ItemResult> {
  const key = item.externalId
  if (!row) return { external_id: key, status: 'not_found' }
  if (row.archived_at) return { external_id: key, status: 'skipped', reason: 'archived' }
  // 봉투가 아니라 건별로 떨어지는 검증 실패(folder_path 타입·60자·team 형식)
  if (item.parseError) {
    return {
      external_id: key, status: 'failed', reason: item.parseError,
      from: folderPathOfSnapshot(snap, row.folder_id),
    }
  }

  // 마이그레이션이 팀을 옮기는 도구가 되면 안 된다 — 팀 이동은 위키 재빌드를 유발한다.
  if (item.team !== null && item.team !== row.team_code) {
    return { external_id: key, status: 'failed', reason: 'team_mismatch' }
  }
  const teamCode = item.team ?? row.team_code
  const from = folderPathOfSnapshot(snap, row.folder_id)

  // ⚠️ 판정 단계에서는 **절대 폴더를 만들지 않는다**(create: false). APPLY 라고 여기서 만들면
  // 뒤이어 skipped(manual_placement) 로 건너뛸 건의 목표 트리까지 실제로 생성돼, 아무 회의록도
  // 들어가지 않는 빈 폴더가 ACTOR 명의로 트리에 남는다. 생성은 "이동한다"가 확정된 뒤에 한다.
  // 판정에는 생성이 필요 없다 — 조상 규칙은 **이미 존재하는** 조상 체인만 보면 되기 때문이다.
  const resolved = await resolveFolderPath(admin, teamCode, item.folderPath, {
    actorId, activeTeamCodes, snapshot: snap, create: false,
  })
  if (!resolved.ok) {
    // no_team_root 는 moved 로 집계하면 안 된다 — 배치는 '등록'이 아니라 '이동'이라
    // folder_id 를 null 로 만드는 것은 회의록을 미분류로 빼내는 것이라 목적과 반대다.
    // 폴백을 적용하지 않고(folder_id 무변경) 실패로 보고한다. 원인은 거의 항상 0043 미적용.
    return { external_id: key, status: 'failed', reason: resolved.reason, from }
  }

  // dry run 에서는 목표 폴더가 아직 없을 수 있다(생성하지 않으므로) — 그때 targetId 는 null.
  const targetId = resolved.complete ? resolved.folderId : null

  // 요건 10 — already_correct 가 §8.3 판정 전체보다 **먼저**다. 그러지 않으면 1차 APPLY 로
  // 하위 폴더에 옮긴 건들이 재실행 dry-run 에서 전부 manual_placement 로 집계돼, 또박또박이
  // OVERWRITE_MANUAL 을 켤지 판단하는 근거가 오염된다(최악은 진짜 사람이 옮긴 건까지 덮는 것).
  if (targetId !== null && row.folder_id === targetId) {
    return { external_id: key, status: 'already_correct', from, folder_id: targetId }
  }

  // §4c.5 **조상 규칙**(결정 §2-J) — 판정 기준이 "팀 루트냐"가 아니라 "현재 위치가 목표 경로의
  // 조상이냐"다. 조상이면 더 깊게 넣는 것이므로 사람의 정리를 훼손하지 않는다(팀 루트는 그
  // 특수 케이스일 뿐이다). 형제·자손·무관한 가지로 옮겨 둔 건은 그대로 보호된다 —
  // 얕은 쪽으로 되돌리는 이동도 조상이 아니므로 skip 이라 배치가 트리를 평평하게 만들지 않는다.
  const movable = row.folder_id === null || ancestorIdsOf(snap, resolved.folderId).has(row.folder_id)
  if (!batch.overwriteManual && !movable) {
    return { external_id: key, status: 'skipped', reason: 'manual_placement', from }
  }

  if (batch.dryRun) {
    return {
      external_id: key, status: 'moved', from, to: resolved.targetPath, folder_id: targetId,
      folder_path_status: folderPathStatusOf({
        folderId: resolved.folderId, truncated: resolved.truncated, failed: false,
      }),
    }
  }

  // 이동이 확정된 지금에서야 부족한 폴더를 만든다.
  const applied = await resolveFolderPath(admin, teamCode, item.folderPath, {
    actorId, activeTeamCodes, snapshot: snap, create: true,
  })
  if (!applied.ok) return { external_id: key, status: 'failed', reason: applied.reason, from }
  // 경로를 끝까지 못 만들었다 = 생성 실패. 조상에 떨구면 리포트(to)와 실제 트리가 어긋난다.
  if (!applied.complete) {
    return {
      external_id: key, status: 'failed',
      reason: `folder_error: ${applied.targetPath.join('/')} 생성 실패`, from,
    }
  }
  const pathStatus = folderPathStatusOf({
    folderId: applied.folderId, truncated: applied.truncated, failed: applied.failed,
  })
  // updated_at 을 갱신하지 않는다(요건 2) — 대량 마이그레이션이 또박또박 목록에서
  // 전건 '방금 수정됨'으로 보이면 안 된다. 버전 append 도 없다(요건 3) — RPC 경유 금지.
  const { data, error } = await admin.from('minutes')
    .update({ folder_id: applied.folderId }).eq('id', row.id).select('id')
  if (error) {
    console.error(`[minutes-api] 재편철 실패(${key}):`, error.message)
    return { external_id: key, status: 'failed', reason: `update_failed: ${error.message}`, from }
  }
  if (!data || data.length === 0) {
    return { external_id: key, status: 'failed', reason: 'update_failed: 대상 없음', from }
  }
  return {
    external_id: key, status: 'moved', from,
    to: applied.targetPath, folder_id: applied.folderId, folder_path_status: pathStatus,
  }
}

export async function POST(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiBadRequest('잘못된 요청입니다.')
  }
  // 게이트 순서: gate → parseUserEmail → resolveUserByEmail → 페이로드 검증.
  // 이 순서라야 또박또박의 ACTOR_EMAIL 프로브(빈 items + dry_run)가 성립한다 —
  // 계정이 불량이면 items 길이를 보기 전에 403 unknown_user 가 먼저 나온다.
  const userEmail = parseUserEmail(raw)
  if (!userEmail) return apiBadRequest('user_email이 필요합니다.')

  try {
    const admin = createAdminClient()
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', "해당 이메일의 D'Flow 사용자가 없습니다.")
    // 결정 §2-H — 다른 라우트의 계정 게이트는 auth.users 실재만 본다. 배치는 그 계정 명의로
    // 폴더를 만들고 그 사람이 생성 트리의 유일한 관리자가 되므로, ACTOR_EMAIL 오타가
    // **실재하는 다른 직원**을 가리키면 조용히 성공한다(되돌리려면 DB 직접 수정).
    // items: [] 프로브도 이 게이트를 통과해야 하므로 오설정이 첫 호출에서 드러난다.
    // 판정은 새 권한 축(is_superuser 또는 어느 프로젝트든 admin)으로 한다 —
    // memberships.role 은 0054 에서 박제돼 갱신되지 않으므로 읽으면 드리프트가 쌓인다.
    if (!(await isBatchAuthorized(admin, user.id))) {
      return apiFail(403, 'forbidden_role', '일괄 재편철은 관리자 계정으로만 실행할 수 있습니다.')
    }

    const parsed = parseBatchPayload(raw)
    if ('error' in parsed) return apiBadRequest(parsed.error)
    const batch = parsed.batch

    const summaryOf = (results: ItemResult[]) => ({
      total: results.length,
      moved: results.filter(r => r.status === 'moved').length,
      already_correct: results.filter(r => r.status === 'already_correct').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      not_found: results.filter(r => r.status === 'not_found').length,
      failed: results.filter(r => r.status === 'failed').length,
    })

    // items: [] 는 **유효 요청**이다(요건 9) — 또박또박이 배치 시작 전에 이 요청으로
    // ACTOR_EMAIL 을 검증한다. 400 으로 좁히면 정상 계정에서도 프로브가 실패해
    // 마이그레이션 시작 자체가 불가해진다.
    if (batch.items.length === 0) {
      return NextResponse.json({ ok: true, dry_run: batch.dryRun, summary: summaryOf([]), results: [] })
    }

    const snap = await loadFolderSnapshot(admin)
    if (!snap) return apiInternalError('폴더 목록을 불러오지 못했습니다.')

    // 대상 회의록을 한 번에 조회 — 건별 왕복을 없앤다.
    const ids = Array.from(new Set(batch.items.map(i => i.externalId)))
    const { data: rowsRaw, error: selErr } = await admin.from('minutes')
      .select('id, external_id, team_code, folder_id, archived_at').in('external_id', ids)
    if (selErr) {
      console.error('[minutes-api] 재편철 대상 조회 실패:', selErr.message)
      return apiInternalError()
    }
    const byExternalId = new Map<string, MinuteRow>()
    for (const r of (rowsRaw ?? []) as MinuteRow[]) byExternalId.set(r.external_id, r)

    const activeTeamCodes = activeTeamCodesSync()
    const results: ItemResult[] = []
    for (const item of batch.items) {
      const res = await processItem(
        admin, item, byExternalId.get(item.externalId), snap, batch, user.id, activeTeamCodes,
      )
      // 같은 external_id 가 한 요청에 두 번 오면 두 번째는 갱신된 위치를 봐야 한다 —
      // 안 그러면 이미 옮긴 건이 다시 moved 로 집계된다(멱등 위반).
      const row = byExternalId.get(item.externalId)
      if (row && res.status === 'moved' && !batch.dryRun && res.folder_id) row.folder_id = res.folder_id
      results.push(res)
    }

    return NextResponse.json({
      ok: true, dry_run: batch.dryRun, summary: summaryOf(results), results,
    })
  } catch (e) {
    console.error('[minutes-api] 재편철 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
