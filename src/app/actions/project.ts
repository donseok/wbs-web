'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { DEMO, DEMO_PROJECT } from '@/lib/demo'

export async function listProjects() {
  if (DEMO) return [DEMO_PROJECT]
  const sb = await createServerClient()
  const { data } = await sb.from('projects').select('*').order('created_at', { ascending: false })
  return data ?? []
}

export async function createProject(
  name: string,
  start: string | null,
  end: string | null,
  description: string | null = null,
) {
  if (DEMO) return // 데모 모드: 저장 비활성화
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
  const sb = await createServerClient()
  const { error } = await sb.from('projects').insert({ name, start_date: start, end_date: end, description })
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
}

export async function addHoliday(projectId: string, date: string, name: string) {
  if (DEMO) return // 데모 모드: 저장 비활성화
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .upsert({ project_id: projectId, date, name }, { onConflict: 'project_id,date' })
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}/settings`)
}

export async function removeHoliday(projectId: string, date: string) {
  if (DEMO) return // 데모 모드: 저장 비활성화
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
  const sb = await createServerClient()
  const { error } = await sb
    .from('holidays')
    .delete()
    .eq('project_id', projectId)
    .eq('date', date)
  if (error) throw new Error(error.message)
  revalidatePath(`/p/${projectId}/settings`)
}
