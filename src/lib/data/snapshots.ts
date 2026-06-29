import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { DEMO, DEMO_SNAPSHOTS } from '@/lib/demo'
import type { ProgressSnapshot } from '@/lib/domain/types'

/** 프로젝트 진척 스냅샷(추세). 캡처일 오름차순. */
export const getSnapshots = cache(async (projectId: string): Promise<ProgressSnapshot[]> => {
  if (DEMO) return DEMO_SNAPSHOTS
  const sb = await createServerClient()
  const { data } = await sb
    .from('progress_snapshots')
    .select('*')
    .eq('project_id', projectId)
    .order('captured_on', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    capturedOn: r.captured_on as string,
    actual: Number(r.overall_actual),
    planned: Number(r.overall_planned),
  }))
})
