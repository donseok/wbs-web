// 0076 폴더 백필 — 프로젝트 배정된 회의록의 기존 편철(대개 미지정/전역 트리)을
// 그 프로젝트 전용 트리로 이식한다. 일회성 운영 러너(wiki-rebuild.runner.ts 전례).
//
// 실행(dry-run):  BACKFILL_TARGET=staging npx vitest run --config scripts/backfill-0076.vitest.ts --reporter=verbose
// 실행(적용):     BACKFILL_TARGET=staging BACKFILL_APPLY=1 BACKFILL_ACTOR=<uuid> \
//                   npx vitest run --config scripts/backfill-0076.vitest.ts --reporter=verbose
// TARGET=prod 는 스테이징 검증 완료 후에만. 환경키는 .env.local.<target> 에서 읽는다.
//
// 이 러너는 refileMinuteAfterProjectChange 를 쓰지 않는다 — 그쪽은 compare-and-set 으로
// "동시에 다른 요청이 옮겼으면 덮지 않는다"를 보장하지만, 이 백필은 마이그레이션 창(앱 정지)
// 동안 단독으로 돈다는 전제라 CAS 가 필요 없고, 오히려 진행률 집계(moved/unfiled/kept)를
// 직접 갖고 있어야 해서 자체 루프를 쓴다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { activeCodes, resolveTeamsForProject, type Team } from '@/lib/domain/teams'
import { loadFolderSnapshot, resolveFolderPath } from '@/lib/minutes/folders'
import type { TeamCode } from '@/lib/domain/types'
import { decideBackfillAction } from './lib/backfill-0076-decide'

function envOf(target: string): { url: string; key: string } {
  const raw = readFileSync(new URL(`../.env.local.${target}`, import.meta.url), 'utf8')
  const pick = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"(.*)"$/, '$1')
  const url = pick('NEXT_PUBLIC_SUPABASE_URL')
  const key = pick('SUPABASE_SERVICE_ROLE_KEY') ?? pick('SUPABASE_SERVICE_ROLE')
  if (!url || !key) throw new Error(`.env.local.${target} 에서 URL/서비스키를 찾지 못했습니다`)
  return { url, key }
}

describe('0076 폴더 백필', () => {
  it('프로젝트 있는 회의록의 편철을 프로젝트 트리로 이식한다', async () => {
    const target = process.env.BACKFILL_TARGET
    if (!target) { console.log('BACKFILL_TARGET 미지정 — skip'); return }
    const apply = process.env.BACKFILL_APPLY === '1'
    // 브리핑 "주의" — literal 'backfill-0076' 는 uuid 가 아니라 auth.users FK(created_by) 위반.
    // dry-run(create:false) 은 폴더를 만들지 않으므로 actorId 가 실제로 쓰이지 않지만,
    // apply 에서만 필수로 강제해 dry-run 확인 없이 실 운영자 uuid 를 요구하지 않게 한다.
    const actorId = apply
      ? (process.env.BACKFILL_ACTOR ?? (() => { throw new Error('apply 모드에는 BACKFILL_ACTOR(uuid) 가 필요합니다') })())
      : 'dry-run-unused'
    const { url, key } = envOf(target)
    const admin = createClient(url, key, { auth: { persistSession: false } })

    // 유효 팀 마스터 — activeTeamCodesForProjectSync 와 같은 규칙(lib/domain/teams 의 순수
    // 함수를 그대로 재사용)을 이 자리에서 계산한다. lib/teams/master 의 서버 캐시는 프로세스
    // 상주 캐시라 이 일회성 스크립트에는 없다(콜드스타트뿐이라 재사용해도 이득이 없다).
    // ⚠ active=true 로 미리 걸러 읽으면 안 된다 — resolveTeamsForProject 의 폴백 판정은
    //   "프로젝트 소속 팀이 하나라도 있는가"를 **비활성 포함**으로 본다(전 팀 비활성화가
    //   전역 상속으로 오인되면 안 되므로). 그래서 전량을 읽어 도메인 함수에 그대로 넘긴다.
    const { data: teamRows, error: tErr } = await admin.from('teams')
      .select('id, code, sort_order, active, progress_visible, project_id')
    expect(tErr).toBeNull()
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
    expect(snap).not.toBeNull()
    const { data: minutes, error: mErr } = await admin.from('minutes')
      .select('id, team_code, project_id, folder_id')
      .not('project_id', 'is', null)
    expect(mErr).toBeNull()

    const log: { minuteId: string; oldFolderId: string | null; newFolderId: string | null }[] = []
    let moved = 0, unfiled = 0, kept = 0
    for (const m of minutes ?? []) {
      const oldFolderId = (m.folder_id as string | null) ?? null
      const decision = decideBackfillAction(snap!, {
        id: m.id as string, projectId: m.project_id as string, folderId: oldFolderId,
      })
      if (decision.action === 'kept') { kept += 1; continue }
      if (decision.action === 'unfiled') {
        log.push({ minuteId: m.id as string, oldFolderId, newFolderId: null })
        unfiled += 1
        continue
      }
      const res = await resolveFolderPath(admin as never, m.team_code as TeamCode, decision.path, {
        actorId, activeTeamCodes: activeCodesFor(m.project_id as string),
        snapshot: snap!, projectId: m.project_id as string, create: apply,
      })
      // dry-run(apply=false): complete 한 경로만 "이관될 것"으로 센다(미생성 조상은 미확정).
      // apply: ok 면 채택한다 — 자식 생성이 중간에 실패해도(failed:true) 조상까지는 실제로
      // 옮겨진 상태이므로 folder_id 를 그 조상에 맞춘다(등록 실패시 조상 편철과 같은 관례).
      const newFolderId = res.ok && (apply || res.complete) ? res.folderId : null
      log.push({ minuteId: m.id as string, oldFolderId, newFolderId })
      if (newFolderId === null) unfiled += 1; else moved += 1
      if (apply) {
        const { error } = await admin.from('minutes')
          .update({ folder_id: newFolderId }).eq('id', m.id)
        expect(error).toBeNull()
      }
    }
    mkdirSync(new URL('../outputs', import.meta.url), { recursive: true })
    writeFileSync(new URL(`../outputs/0076-folder-backfill-${target}.json`, import.meta.url),
      JSON.stringify({ target, apply, movedCount: moved, unfiledCount: unfiled, keptCount: kept, log }, null, 2))
    console.log(`[0076 backfill] target=${target} apply=${apply} moved=${moved} unfiled=${unfiled} kept=${kept}`)

    if (apply) {
      // VERIFY: 프로젝트 있는 회의록의 폴더는 같은 프로젝트 소속이어야 한다(불변식).
      const snap2 = await loadFolderSnapshot(admin as never)
      const { data: after } = await admin.from('minutes')
        .select('id, project_id, folder_id').not('project_id', 'is', null)
      const violations = (after ?? []).filter(m =>
        m.folder_id && snap2!.byId.get(m.folder_id as string)?.projectId !== m.project_id)
      expect(violations).toEqual([])
    }
  }, 120_000)
})
