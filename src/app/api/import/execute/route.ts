import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { validateProfile } from '@/lib/excel/profile'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'
import { splitLeafOwners } from '@/lib/excel/validate'
import { teamsSync } from '@/lib/teams/master'
import { addTeam } from '@/app/actions/teams'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { ingestProject } from '@/lib/ai/ingest'
import { isUuidLike } from '@/lib/domain/agentWork'

/** 가드 실패 사유 → HTTP status. 기존 `/api/import` 의 매핑을 복제한다(원본 파일은 건드리지 않는다).
 *  조회 실패는 거부가 아니라 서버 사정이므로 500(재시도 가능). */
const AUTHZ_STATUS: Record<string, number> = { '로그인 필요': 401, '권한 없음': 403 }

/** replace 모드가 백업하지 않는 부수 효과를 명시 경고한다(B2 리뷰 이월).
 *  change_logs 는 wbs_items 의 on delete cascade 로 함께 지워지고(Q1 결정 — 백업은 트리뿐),
 *  holidays 는 replace_wbs 가 delete 하지 않고 upsert 만 한다(갱신되되 잔존 항목이 남을 수 있음). */
const REPLACE_WARNINGS = [
  '변경 이력(change_logs)은 백업에 포함되지 않으며 교체 시 함께 삭제되어 복구할 수 없습니다.',
  '휴일은 삭제되지 않고 갱신만 됩니다.',
]

type ImportMode = 'append' | 'replace'

/**
 * 임포트 마법사 2단계 — 실제 쓰기(§6.6). append 는 기존 import_wbs 와 동일하게 삽입만,
 * replace 는 백업 선행 후 전체 교체(§6.6-2). 팀 부트스트랩(§10.3)은 이 라우트가 유일한 진입점이다.
 * 판정 대상 프로젝트가 본문에 있어 폼을 먼저 읽는다 — 파싱·DB 접근은 가드 통과 후에만 한다.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const projectId = String(form.get('projectId') ?? '')
  const profileRaw = String(form.get('profile') ?? '')
  const mode = String(form.get('mode') ?? '')
  const saveProfile = form.get('saveProfile') === 'true'
  const registerTeams = form.get('registerTeams') === 'true'

  if (!file || !projectId || !profileRaw) {
    return NextResponse.json({ error: '파일/프로젝트/프로파일 누락' }, { status: 400 })
  }
  if (mode !== 'append' && mode !== 'replace') {
    return NextResponse.json({ error: "mode는 'append' 또는 'replace' 여야 합니다" }, { status: 400 })
  }
  // agent-loop 교훈 — 비 UUID 를 그대로 흘리면 가드·쿼리가 엉뚱한 에러로 새어나간다. 가드보다 먼저 막는다.
  if (!isUuidLike(projectId)) {
    return NextResponse.json({ error: '프로젝트 식별자 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: AUTHZ_STATUS[g.error] ?? 500 })

  let profileJson: unknown
  try {
    profileJson = JSON.parse(profileRaw)
  } catch {
    return NextResponse.json({ error: '프로파일 JSON 형식이 올바르지 않습니다' }, { status: 400 })
  }
  const validated = validateProfile(profileJson)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const profile = validated.profile

  const parsed = parseWithProfile(await file.arrayBuffer(), profile)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 구조 검증(linkByDepth) 을 팀 부트스트랩보다 먼저 통과시킨다(리뷰 Minor). 원래 순서는 팀 등록이
  // 먼저라 링킹이 400 으로 실패해도 전역 팀 마스터에 이미 등록된 팀이 남는 부수효과가 있었다 — 검증에
  // 실패하는 요청은 아무 부수효과도 남기지 않아야 한다.
  const linked = linkByDepth(parsed.rows, { legacyLevelLabels: resolveLegacyLevelLabels(profile) })
  if (!linked.ok) return NextResponse.json({ errors: linked.errors }, { status: 400 })

  // 팀 마스터 대조(§10.3) — 미등록 팀은 조용한 스킵이 아니라 명시 확인·부트스트랩 대상이다.
  const registered = new Set(teamsSync().map(t => t.code))
  const unknownTeams = [...new Set(parsed.rows.flatMap(r => r.owners.map(o => o.team)))]
    .filter(t => !registered.has(t))

  if (unknownTeams.length > 0) {
    if (!registerTeams) {
      return NextResponse.json({ needsTeams: unknownTeams }, { status: 409 })
    }
    // 팀 마스터는 전역 기준정보 — 프로젝트 관리자가 아니라 슈퍼유저만 등록(addTeam 과 동일 게이트).
    const su = await requireSuperuser()
    if (!su.ok) return NextResponse.json({ error: '팀 등록은 슈퍼유저 권한' }, { status: 403 })
    for (const team of unknownTeams) {
      // /admin/teams 의 addTeam 액션을 그대로 재사용 — code·sort_order 말번 채번·active(DB 기본값 true) 관례를
      // 새로 베끼지 않는다(report/export 라우트가 이미 서버 액션을 직접 호출하는 선례가 있다).
      const added = await addTeam(team)
      if (!added.ok) {
        return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
      }
    }
  }

  const items = splitLeafOwners(linked.items)

  const sb = await createServerClient()
  let count: number
  let backup: { rows: unknown[]; generatedAt: string } | undefined
  const warnings: string[] = []

  if (mode === 'replace') {
    // 백업 먼저(§6.6-2, Q1: wbs_items 전 컬럼만 — change_logs 는 대상 아님). 실패 시 RPC 를 호출하지 않고 중단한다.
    const { data: backupRows, error: backupErr } = await sb
      .from('wbs_items').select('*').eq('project_id', projectId)
    if (backupErr) {
      console.error('[import/execute] replace 백업 select 실패 — RPC 미호출:', backupErr.message)
      return NextResponse.json({ error: `백업 생성 실패로 중단했습니다: ${backupErr.message}` }, { status: 500 })
    }
    backup = { rows: backupRows ?? [], generatedAt: new Date().toISOString() }
    warnings.push(...REPLACE_WARNINGS)

    const { data, error } = await sb.rpc('replace_wbs', {
      p_project_id: projectId, p_items: items, p_holidays: parsed.holidays,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    count = typeof data === 'number' ? data : items.length
  } else {
    const { data, error } = await sb.rpc('import_wbs', {
      p_project_id: projectId, p_items: items, p_holidays: parsed.holidays,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    count = typeof data === 'number' ? data : items.length
  }

  // 프로파일 저장(Q4) — project_settings 는 쓰기 정책이 없다(0058 service_role 전용 관문, createProject 시드와 동일 경로).
  let profileSaved = false
  if (saveProfile) {
    const admin = createAdminClient()
    // 0058 project_settings 는 updated_at 트리거가 없다(0038 주석 관례 계승) — UPDATE 분기에서는
    // 컬럼 default now() 가 타지 않으므로 앱이 두 필드를 직접 채운다(actions/llmConfig.ts:285 선례).
    const { error: upsertErr } = await admin
      .from('project_settings')
      .upsert(
        { project_id: projectId, excel_profile: profile, updated_by: g.actor.userId, updated_at: new Date().toISOString() },
        { onConflict: 'project_id' },
      )
    if (upsertErr) console.error('[import/execute] 프로파일 저장 실패(무시):', upsertErr.message)
    else profileSaved = true
  }

  // 임포트는 실적·계획 전면 교체(또는 신규 반영) — 즉시 스냅샷 기록(라우트라 await로 충분).
  await recordProgressSnapshot(projectId)

  // 임포트 성공 후 DK Bot 의미검색 색인 갱신(베스트에포트 — 임베딩 키 없으면 자동 skip).
  let reindexed = 0
  try {
    reindexed = (await ingestProject(projectId)).count
  } catch (e) {
    console.error('[dkbot] 임포트 후 색인 실패(무시):', e)
  }

  return NextResponse.json({
    ok: true,
    count,
    mode: mode as ImportMode,
    reindexed,
    ...(backup ? { backup } : {}),
    profileSaved,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
