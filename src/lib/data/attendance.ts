import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { AttendanceRecord, AttendanceType } from '@/lib/domain/types'

export const getAttendanceRecords = cache(async (projectId: string): Promise<AttendanceRecord[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('attendance_records')
    .select('id, project_id, member_id, date, type, note')
    .eq('project_id', projectId)
    .order('date', { ascending: true })

  // 근태 페이지·대시보드·주간보고(api/report)가 이 한 조회를 공유한다 —
  // 실패를 삼키면 세 산출물이 동시에 '근태 기록 없음'으로 조용히 비어 원인 추적이 불가능하다.
  if (error) console.error('[getAttendanceRecords] 조회 실패:', error.message)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    memberId: r.member_id as string,
    date: r.date as string,
    type: r.type as AttendanceType,
    note: (r.note as string) ?? null,
  }))
})
