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
  // 대상 멤버가 **이 프로젝트 로스터** 소속인지 확인한다. 없으면 남의 프로젝트 멤버 id 로
  // 이 프로젝트 근태 행을 만들 수 있고(로스터 읽기는 전면 개방이라 id 확보가 쉽다),
  // unique(member_id,date) 때문에 그 회사 프로젝트의 정당한 입력이 이후 영구히 막힌다.
  // meetings.replaceAttendees·issues.replaceAssignees 가 이미 쓰는 대조를 여기에도 둔다.
  const { data: member, error: memberErr } = await sb
    .from('project_members').select('id')
    .eq('id', input.memberId).eq('project_id', projectId).maybeSingle()
  if (memberErr) {
    console.error('[upsertAttendance] 로스터 확인 실패:', memberErr.message)
    return { ok: false, error: '대상 멤버를 확인할 수 없어 중단했습니다.' }
  }
  if (!member) return { ok: false, error: '이 프로젝트의 멤버가 아닙니다.' }

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
