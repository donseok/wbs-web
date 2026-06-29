'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function listProjects() {
  const sb = await createServerClient()
  const { data } = await sb.from('projects').select('*').order('created_at', { ascending: false })
  return data ?? []
}

export async function createProject(name: string, start: string | null, end: string | null) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') throw new Error('권한 없음')
  const sb = await createServerClient()
  const { error } = await sb.from('projects').insert({ name, start_date: start, end_date: end })
  if (error) throw new Error(error.message)
  revalidatePath('/projects')
}

export async function addHoliday(projectId: string, date: string, name: string) {
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
