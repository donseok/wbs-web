// 0076 백필 러너의 실행 본체 — vitest 트리거(scripts/backfill-0076.runner.ts)에서 떼어냈다.
// 이유는 wiki-rebuild-loop.mjs 와 같다: 러너 파일 자체를 import 하면 톱레벨 describe/it 이
// 즉시 실 DB 를 부르므로, admin 클라이언트를 인자로 받는 형태로 여기 떼어내야 가짜 클라이언트로
// (순서·판정을) 테스트할 수 있다. Task 9 리뷰(Critical 1) — 사전 스냅샷이 어떤 update 보다도
// 먼저 기록되는지를 fixture 로 검증하려면 이 분리가 필요했다.
import { mkdirSync, writeFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { activeCodes, resolveTeamsForProject, type Team } from '@/lib/domain/teams'
import { loadFolderSnapshot, resolveFolderPath } from '@/lib/minutes/folders'
import type { TeamCode } from '@/lib/domain/types'
import { buildPreSnapshot, decideBackfillAction, type BackfillLogReason } from './backfill-0076-decide'

export interface BackfillLogEntry {
  minuteId: string
  oldFolderId: string | null
  newFolderId: string | null
  reason: BackfillLogReason
}

export interface BackfillPassResult {
  moved: number
  unfiled: number
  kept: number
  log: BackfillLogEntry[]
}

/** 0076 백필 1회 실행 — dry-run/apply 공용. admin 은 이미 만들어진 service_role 클라이언트.
 *  실패는 예외로 던진다(vitest 의 it() 이 그대로 실패 처리하도록 — expect() 를 여기 끌어들이면
 *  이 모듈이 vitest 전용이 되어 fixture 재사용이 어색해진다). */
export async function runBackfillPass(params: {
  admin: SupabaseClient
  target: string
  apply: boolean
  actorId: string
}): Promise<BackfillPassResult> {
  const { admin, target, apply, actorId } = params

  // 유효 팀 마스터 — activeTeamCodesForProjectSync 와 같은 규칙(lib/domain/teams 의 순수
  // 함수를 그대로 재사용)을 이 자리에서 계산한다. lib/teams/master 의 서버 캐시는 프로세스
  // 상주 캐시라 이 일회성 스크립트에는 없다(콜드스타트뿐이라 재사용해도 이득이 없다).
  // ⚠ active=true 로 미리 걸러 읽으면 안 된다 — resolveTeamsForProject 의 폴백 판정은
  //   "프로젝트 소속 팀이 하나라도 있는가"를 **비활성 포함**으로 본다(전 팀 비활성화가
  //   전역 상속으로 오인되면 안 되므로). 그래서 전량을 읽어 도메인 함수에 그대로 넘긴다.
  const { data: teamRows, error: tErr } = await admin.from('teams')
    .select('id, code, sort_order, active, progress_visible, project_id')
  if (tErr) throw new Error(`teams 조회 실패: ${tErr.message}`)
  const allTeams: Team[] = ((teamRows ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: String(r.id),
    code: (r.code as string).trim() as TeamCode,
    sortOrder: Number(r.sort_order ?? 0),
    active: r.active !== false,
    progressVisible: r.progress_visible !== false,
    projectId: (r.project_id as string | null) ?? null,
  }))
  const activeCodesFor = (pid: string): TeamCode[] => activeCodes(resolveTeamsForProject(allTeams, pid))

  const snap = await loadFolderSnapshot(admin as never)
  if (!snap) throw new Error('폴더 스냅샷 로드 실패(로그는 loadFolderSnapshot 이 이미 남김)')

  const { data: minutesData, error: mErr } = await admin.from('minutes')
    .select('id, team_code, project_id, folder_id')
    .not('project_id', 'is', null)
  if (mErr) throw new Error(`minutes 조회 실패: ${mErr.message}`)
  const rows = (minutesData ?? []) as Array<
    { id: string; team_code: string; project_id: string; folder_id: string | null }
  >

  mkdirSync(new URL('../../outputs', import.meta.url), { recursive: true })

  if (apply) {
    // 롤백 복원용 사전 스냅샷 — **어떤 update 보다도 먼저** 기록한다(Task 9 리뷰 Important 2).
    // 루프 중간에 실패해도 이미 쓴 N건의 원래 위치를 이 파일로 복원할 수 있어야 한다 — 사후
    // 로그(아래)는 루프가 끝까지 돌아야만 쓰이므로 중간 실패 시 그것만으로는 유실된다.
    // 기록 자체가 실패하면(디스크 등) 여기서 던져 apply 를 아예 시작하지 않는다.
    const pre = buildPreSnapshot(rows)
    writeFileSync(
      new URL(`../../outputs/0076-folder-backfill-${target}.pre.json`, import.meta.url),
      JSON.stringify({ target, capturedAt: new Date().toISOString(), count: pre.length, log: pre }, null, 2),
    )
  }

  const log: BackfillLogEntry[] = []
  let moved = 0, unfiled = 0, kept = 0
  for (const m of rows) {
    const oldFolderId = m.folder_id ?? null
    const decision = decideBackfillAction(snap, {
      id: m.id, projectId: m.project_id, folderId: oldFolderId,
    })

    if (decision.action === 'kept') {
      log.push({ minuteId: m.id, oldFolderId, newFolderId: oldFolderId, reason: 'kept' })
      kept += 1
      continue
    }

    if (decision.action === 'unfiled') {
      // Task 9 리뷰 Critical 1 — 끊긴 체인은 "미분류로 강등"이 결정인데, apply 에서 실제로
      // folder_id 를 null 로 쓰지 않으면 옛 folder_id 가 그대로 남아 VERIFY 불변식(프로젝트
      // 있는 회의록의 폴더는 같은 프로젝트 소속)을 위반한다. resolve 분기의 update 와 동일하게
      // apply 에서만 쓰고, CAS 는 쓰지 않는다(이 러너는 마이그레이션 창 동안 단독 실행 전제).
      log.push({ minuteId: m.id, oldFolderId, newFolderId: null, reason: 'broken-chain' })
      unfiled += 1
      if (apply) {
        const { error } = await admin.from('minutes').update({ folder_id: null }).eq('id', m.id)
        if (error) throw new Error(`${m.id} 미분류 강등 실패: ${error.message}`)
      }
      continue
    }

    const res = await resolveFolderPath(admin as never, m.team_code as TeamCode, decision.path, {
      actorId, activeTeamCodes: activeCodesFor(m.project_id),
      snapshot: snap, projectId: m.project_id, create: apply,
    })
    // dry-run(apply=false): complete 한 경로만 "이관될 것"으로 센다(미생성 조상은 미확정).
    // apply: ok 면 채택한다 — 자식 생성이 중간에 실패해도(failed:true) 조상까지는 실제로
    // 옮겨진 상태이므로 folder_id 를 그 조상에 맞춘다(등록 실패시 조상 편철과 같은 관례).
    const newFolderId = res.ok && (apply || res.complete) ? res.folderId : null
    const reason: BackfillLogReason = newFolderId === null ? 'no-target' : 'moved'
    log.push({ minuteId: m.id, oldFolderId, newFolderId, reason })
    if (newFolderId === null) unfiled += 1; else moved += 1
    if (apply) {
      const { error } = await admin.from('minutes').update({ folder_id: newFolderId }).eq('id', m.id)
      if (error) throw new Error(`${m.id} 편철 갱신 실패: ${error.message}`)
    }
  }

  writeFileSync(
    new URL(`../../outputs/0076-folder-backfill-${target}.json`, import.meta.url),
    JSON.stringify({ target, apply, movedCount: moved, unfiledCount: unfiled, keptCount: kept, log }, null, 2),
  )
  console.log(`[0076 backfill] target=${target} apply=${apply} moved=${moved} unfiled=${unfiled} kept=${kept}`)

  if (apply) {
    // VERIFY: 프로젝트 있는 회의록의 폴더는 같은 프로젝트 소속이어야 한다(불변식).
    const snap2 = await loadFolderSnapshot(admin as never)
    if (!snap2) throw new Error('VERIFY: 폴더 스냅샷 재로드 실패')
    const { data: after, error: vErr } = await admin.from('minutes')
      .select('id, project_id, folder_id').not('project_id', 'is', null)
    if (vErr) throw new Error(`VERIFY 조회 실패: ${vErr.message}`)
    const violations = (after ?? []).filter(m =>
      m.folder_id && snap2.byId.get(m.folder_id as string)?.projectId !== m.project_id)
    if (violations.length > 0) {
      throw new Error(`VERIFY 위반 ${violations.length}건 — 불변식 깨짐: ${JSON.stringify(violations)}`)
    }
  }

  return { moved, unfiled, kept, log }
}
