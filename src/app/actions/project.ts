'use server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth'
import { getActorForView, requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { canSeeProject } from '@/lib/domain/authz'
import { isValidDateRange } from '@/lib/domain/validate'
import { PRESETS } from '@/lib/domain/projectPresets'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'

export async function listProjects() {
  return (await listProjectsWithState()).projects
}

/**
 * listProjects 와 같은 폴백을 하되 **실패했다는 사실을 함께 돌려준다**.
 *
 * `[]` 하나로는 "프로젝트가 없는 계정"과 "목록을 못 읽은 상태"가 구분되지 않는다.
 * 2026-08-05 REST 장애 때 화면이 후자를 전자로 그려 '첫 프로젝트를 만들어 보세요' 를
 * 띄웠다 — 데이터가 멀쩡한데 신규 가입자 화면처럼 보였다. 로그는 남았지만 표시가 없었다.
 */
export async function listProjectsWithState() {
  // 세션 확인·목록·권한 조회는 서로를 기다릴 이유가 없다 — 셋을 동시에 시작하고
  // 판단(비로그인 조기 반환)만 세션 결과로 한다. 직렬이면 세션 왕복만큼 목록이 늦어진다.
  const sessionPromise = getSession()
  const projectsPromise = fetchProjects()
  const actorPromise = getActorForView()
  // 서버 액션 직접 호출에 대비한 인증 재확인(RLS와 이중 방어).
  // 비로그인은 '조회 실패' 가 아니다 — degraded=false 여야 미들웨어가 /login 으로 보내는
  // 정상 흐름에 경고 배너가 딸려붙지 않는다.
  if (!(await sessionPromise)) {
    // 조기 반환으로 버려지는 병행 조회가 unhandled rejection 으로 새지 않게 흡수한다
    // (RLS 가 anon 조회를 막아도 프로세스 경고가 남으면 진짜 장애 로그를 오염시킨다).
    projectsPromise.catch(() => {})
    actorPromise.catch(() => {})
    return { projects: [] as ProjectRow[], degraded: false }
  }
  const [{ data, error }, actor] = await Promise.all([projectsPromise, actorPromise])
  // 순수 표시용 조회라 폴백([])을 유지한다 — throw 하면 (app)/layout.tsx 가 호출하므로
  // 프로젝트 목록 하나 깨진 것으로 앱 전 페이지가 에러 화면이 된다(로그인 후 아무 데도 못 감).
  // 이 목록의 '0건'을 근거로 쓰기/삭제를 판단하는 경로는 없어서(생성은 채번·중복검사에 쓰지 않음)
  // 데이터가 손상되지는 않는다. 대신 빈 사이드바의 원인이 사라지지 않도록 로그는 반드시 남긴다.
  if (error) console.error('[listProjects] 조회 실패:', error.message)
  // 비공개 프로젝트(0070)는 역할 보유자·슈퍼유저에게만. 권한 조회 실패(actor null)면
  // 비공개만 빠진 채 공개 목록은 유지된다 — fail-closed 이되 화면 전체를 죽이지 않는다.
  const visible = (data ?? []).filter(p => canSeeProject(actor, p))
  return { projects: visible, degraded: Boolean(error) }
}

type ProjectRow = NonNullable<Awaited<ReturnType<typeof fetchProjects>>['data']>[number]

async function fetchProjects() {
  const sb = await createServerClient()
  return sb.from('projects').select('*').order('created_at', { ascending: false })
}

export async function createProject(
  name: string,
  start: string | null,
  end: string | null,
  description: string | null = null,
) {
  // 프로젝트 생성은 전역 관리 — 슈퍼유저만.
  const g = await requireSuperuser()
  if (!g.ok) throw new Error(g.error)
  if (!isValidDateRange(start || null, end || null)) throw new Error('종료일은 시작일보다 빠를 수 없습니다.')
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('projects')
    .insert({ name, start_date: start, end_date: end, description })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  // 프리셋 선택 UI 는 Plan B — 그때까지 신규 프로젝트는 pi(D-CUBE 형) 기본. §7.4: 키워드 빈 행 방치는 마일스톤 카드 무증상 소실.
  // project_settings 는 쓰기 정책이 없다(0058 — service_role 전용 관문) — projects insert 와 달리 admin 클라이언트가 필요하다.
  const admin = createAdminClient()
  const { error: settingsErr } = await admin.from('project_settings').insert({
    project_id: data.id,
    level_labels: PRESETS.pi.levelLabels,
    max_depth: PRESETS.pi.maxDepth,
    extra_axis_label: PRESETS.pi.extraAxisLabel,
    milestone_keywords: PRESETS.pi.milestoneKeywords,
    preset_applied: 'pi',
  })
  // 실패해도 프로젝트 생성은 성공 — 행이 없으면 getProjectConfig 가 DEFAULT_PROJECT_CONFIG 로 폴백한다(이력 기록 실패와 동일 관례).
  if (settingsErr) console.error('[createProject] project_settings 시드 실패:', settingsErr.message)
  revalidatePath('/projects')
}

export async function updateProject(
  projectId: string,
  fields: { name?: string; description?: string | null; start_date?: string | null; end_date?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) {
    if (!fields.name.trim()) return { ok: false, error: '프로젝트명을 입력하세요' }
    patch.name = fields.name.trim()
  }
  if (fields.description !== undefined) patch.description = fields.description?.trim() || null
  if (fields.start_date !== undefined) patch.start_date = fields.start_date || null
  if (fields.end_date !== undefined) patch.end_date = fields.end_date || null
  if (Object.keys(patch).length === 0) return { ok: true }
  const sb = await createServerClient()
  // 날짜가 패치에 포함될 때만 범위 검증. 한쪽만 온 부분 패치는 DB 현재값과 병합해 비교(우회 방지).
  if ('start_date' in patch || 'end_date' in patch) {
    let start = patch.start_date as string | null | undefined
    let end = patch.end_date as string | null | undefined
    if (start === undefined || end === undefined) {
      const { data: cur, error: curErr } = await sb.from('projects').select('start_date,end_date').eq('id', projectId).single()
      // 현재값 조회 실패 시 검증 불가 — 통과시키지 않고 저장을 중단한다.
      if (curErr || !cur) return { ok: false, error: curErr?.message || '프로젝트를 찾을 수 없습니다.' }
      if (start === undefined) start = (cur.start_date as string | null) ?? null
      if (end === undefined) end = (cur.end_date as string | null) ?? null
    }
    if (!isValidDateRange(start, end)) return { ok: false, error: '종료일은 시작일보다 빠를 수 없습니다.' }
  }
  const { error } = await sb.from('projects').update(patch).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/**
 * 비공개 전환(0070) — 슈퍼유저 전용. 프로젝트 관리자에게 열지 않는 이유:
 * 관리자가 자기 프로젝트를 잠그면 다른 화면(홈 집계·회의록 탐색기)에서 조용히 사라져
 * 조직 차원의 가시성 정책이 프로젝트 단위에서 뒤집힌다. 전역 정책은 전역 등급이 쥔다.
 */
export async function setProjectPrivacy(projectId: string, isPrivate: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  // projects 의 RLS update 정책과 무관하게 동작해야 하는 전역 관리 쓰기 — admin client 로 쓰고
  // 가드(requireSuperuser)가 유일한 관문임을 명시한다(fail-closed).
  const admin = createAdminClient()
  const { error } = await admin.from('projects').update({ is_private: isPrivate }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/** 공정율 기준일 설정. null이면 자동(오늘). 진척 산정 전체에 영향. */
export async function setBaseDate(projectId: string, baseDate: string | null): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { error } = await sb.from('projects').update({ base_date: baseDate || null }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function addHoliday(projectId: string, date: string, name: string) {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) throw new Error(g.error)
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .upsert({ project_id: projectId, date, name }, { onConflict: 'project_id,date' })
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
}

export async function removeHoliday(projectId: string, date: string) {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) throw new Error(g.error)
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .delete()
    .eq('project_id', projectId)
    .eq('date', date)
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
}
