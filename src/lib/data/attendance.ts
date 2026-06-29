import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { AttendanceRecord, AttendanceType } from '@/lib/domain/types'
import { DEMO, DEMO_ATTENDANCE } from '@/lib/demo'

export const getAttendanceRecords = cache(async (projectId: string): Promise<AttendanceRecord[]> => {
  if (DEMO) return DEMO_ATTENDANCE
  const sb = await createServerClient()
  const { data } = await sb
    .from('attendance_records')
    .select('id, project_id, member_id, date, type, note')
    .eq('project_id', projectId)
    .order('date', { ascending: true })

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    memberId: r.member_id as string,
    date: r.date as string,
    type: r.type as AttendanceType,
    note: (r.note as string) ?? null,
  }))
})
