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
