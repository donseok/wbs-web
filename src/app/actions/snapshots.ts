'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { DEMO } from '@/lib/demo'
import { getComputedWbs } from '@/lib/data/wbs'
import { overallProgress } from '@/lib/domain/rollup'

/** 현재 전체 공정율을 오늘 날짜로 스냅샷 저장(같은 날은 갱신). PMO 전용.
 *  주간 자동화가 필요하면 Vercel Cron에서 이 액션을 호출하면 된다. */
export async function captureSnapshot(projectId: string): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: true }
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { items, today } = await getComputedWbs(projectId)
  const { actual, planned } = overallProgress(items)

  const sb = await createServerClient()
  const { error } = await sb.from('progress_snapshots').upsert(
    { project_id: projectId, captured_on: today, overall_actual: actual, overall_planned: planned },
    { onConflict: 'project_id,captured_on' },
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}/dashboard`)
  return { ok: true }
}
