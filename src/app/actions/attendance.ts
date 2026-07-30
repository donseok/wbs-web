'use server'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectMember, resolveProjectId } from '@/lib/authz'
import { revalidatePath } from 'next/cache'
import type { AttendanceType } from '@/lib/domain/types'

/** member_id+date 유니크 충돌 시 갱신(upsert). 해당 프로젝트 멤버 이상만 허용. */
export async function upsertAttendance(
  projectId: string,
  input: { memberId: string; date: string; type: AttendanceType; note?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!input.memberId || !input.date) return { ok: false, error: '멤버와 날짜는 필수입니다' }
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }

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

/** 근태 기록 삭제. 해당 기록이 속한 프로젝트의 멤버 이상만 허용. */
export async function removeAttendance(recordId: string): Promise<{ ok: boolean; error?: string }> {
  // 어느 프로젝트 기록인지 모르면 권한을 판정할 수 없다 — 조회를 게이트 앞에 두고,
  // 조회 실패는 '기록 없음'으로 위장하지 않고 그대로 중단한다(fail-closed).
  const found = await resolveProjectId('attendance_records', recordId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const sb = await createServerClient()
  const { error } = await sb.from('attendance_records').delete().eq('id', recordId)
  if (error) return { ok: false, error: error.message }
  if (found.projectId) revalidatePath(`/p/${found.projectId}/attendance`)
  return { ok: true }
}
