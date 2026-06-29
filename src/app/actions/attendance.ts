'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getMembership } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { DEMO } from '@/lib/demo'
import type { AttendanceType } from '@/lib/domain/types'

/** member_id+date 유니크 충돌 시 갱신(upsert). PMO 관리자만 허용. */
export async function upsertAttendance(
  projectId: string,
  input: { memberId: string; date: string; type: AttendanceType; note?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: true } // 데모 모드: 저장 비활성화(둘러보기용)
  if (!input.memberId || !input.date) return { ok: false, error: '멤버와 날짜는 필수입니다' }
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const { error } = await sb
    .from('attendance_records')
    .upsert(
      {
        project_id: projectId,
        member_id: input.memberId,
        date: input.date,
        type: input.type,
        note: input.note ?? null,
      },
      { onConflict: 'member_id,date' },
    )
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}/attendance`)
  return { ok: true }
}

/** 근태 기록 삭제. PMO 관리자만 허용. */
export async function removeAttendance(recordId: string): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: true } // 데모 모드: 저장 비활성화(둘러보기용)
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  if (m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const sb = await createServerClient()
  const { data: rec } = await sb
    .from('attendance_records')
    .select('project_id')
    .eq('id', recordId)
    .maybeSingle()
  const { error } = await sb.from('attendance_records').delete().eq('id', recordId)
  if (error) return { ok: false, error: error.message }
  if (rec?.project_id) revalidatePath(`/p/${rec.project_id as string}/attendance`)
  return { ok: true }
}
