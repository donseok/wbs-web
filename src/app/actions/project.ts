'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { isValidDateRange } from '@/lib/domain/validate'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'

export async function listProjects() {
  // 서버 액션 직접 호출에 대비한 인증 재확인(RLS와 이중 방어).
  if (!(await getSession())) return []
  const sb = await createServerClient()
  const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: false })
  // 순수 표시용 조회라 폴백([])을 유지한다 — throw 하면 (app)/layout.tsx 가 호출하므로
  // 프로젝트 목록 하나 깨진 것으로 앱 전 페이지가 에러 화면이 된다(로그인 후 아무 데도 못 감).
  // 이 목록의 '0건'을 근거로 쓰기/삭제를 판단하는 경로는 없어서(생성은 채번·중복검사에 쓰지 않음)
  // 데이터가 손상되지는 않는다. 대신 빈 사이드바의 원인이 사라지지 않도록 로그는 반드시 남긴다.
  if (error) console.error('[listProjects] 조회 실패:', error.message)
  return data ?? []
}

export async function createProject(
  name: string,
  start: string | null,
  end: string | null,
  description: string | null = null,
) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
  if (!isValidDateRange(start || null, end || null)) throw new Error('종료일은 시작일보다 빠를 수 없습니다.')
  const sb = await createServerClient()
  const { error } = await sb.from('projects').insert({ name, start_date: start, end_date: end, description })
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
}

export async function updateProject(
  projectId: string,
  fields: { name?: string; description?: string | null; start_date?: string | null; end_date?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
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

/** 공정율 기준일 설정. null이면 자동(오늘). 진척 산정 전체에 영향. */
export async function setBaseDate(projectId: string, baseDate: string | null): Promise<{ ok: boolean; error?: string }> {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }
  const sb = await createServerClient()
  const { error } = await sb.from('projects').update({ base_date: baseDate || null }).eq('id', projectId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function addHoliday(projectId: string, date: string, name: string) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .upsert({ project_id: projectId, date, name }, { onConflict: 'project_id,date' })
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
}

export async function removeHoliday(projectId: string, date: string) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
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
