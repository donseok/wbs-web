import { revalidatePath } from 'next/cache'
import type { AdminClient, ExternalMeetingInput, ResolvedUser } from '@/lib/minutes/externalApi'

/**
 * 외부 회의록 API 의 inline `meeting` 처리 — 회의 확보(신규 생성 또는 dedup 재사용).
 * 계약: docs/design/dflow-minutes-upload-api-spec.md v2.5 §4.2 / 발주 스펙 §1.2·§2.2.
 *
 * 순서가 계약이다: 프로젝트 실존 → 멤버십 → dedup → insert.
 * 멤버십을 dedup 보다 먼저 판정해, 비멤버가 제목·날짜를 맞춰 타 프로젝트의 기존 회의에
 * 회의록을 연결하는 우회를 막는다.
 *
 * 판정 축은 project_members(user_id) — 인력 명단 축이다. 내부 requireProjectMember 는
 * project_roles(권한 축) 기반이라 두 판정이 갈릴 수 있으나(명단·권한은 자동 동기화되지 않는다),
 * 외부 경로는 발주 스펙이 명단 축을 명시했다 — 계정 미연결(user_id NULL) 멤버가 403 을 받는
 * 것도 의도된 동작이다.
 *
 * meetings 테이블은 RLS insert 정책이 created_by = auth.uid() 를 요구해 세션 없는 대리 생성을
 * 막으므로 DB 2차 방어선이 없다 — 이 함수의 애플리케이션 검증이 유일한 관문이다(회의록 계열과
 * 같은 패턴). 조회·insert 실패는 '없음'으로 오인하지 않고 500 — 쓰기 선행조회 실패는 중단.
 */
export async function resolveOrCreateExternalMeeting(
  admin: AdminClient,
  m: ExternalMeetingInput,
  user: ResolvedUser,
): Promise<
  | { ok: true; meetingId: string; projectId: string; created: boolean }
  | { ok: false; status: 400 | 403 | 500; code: string; error: string }
> {
  const fail500 = {
    ok: false as const, status: 500 as const, code: 'internal_error', error: '서버 오류가 발생했습니다.',
  }

  const { data: proj, error: projErr } = await admin
    .from('projects').select('id').eq('id', m.projectId).maybeSingle()
  if (projErr) {
    console.error('[minutes-api] 회의 생성 프로젝트 확인 실패:', projErr.message)
    return fail500
  }
  if (!proj) {
    return { ok: false, status: 400, code: 'validation_failed', error: '프로젝트를 찾을 수 없습니다.' }
  }

  const { data: members, error: memErr } = await admin
    .from('project_members').select('id')
    .eq('project_id', m.projectId).eq('user_id', user.id).limit(1)
  if (memErr || !members) {
    console.error('[minutes-api] 회의 생성 멤버십 확인 실패(거절):', memErr?.message ?? 'no rows')
    return fail500
  }
  if (members.length === 0) {
    return { ok: false, status: 403, code: 'not_project_member', error: '해당 프로젝트의 멤버가 아닙니다.' }
  }

  // dedup 멱등 — 같은 (project_id, meeting_date, trim 된 title) 회의는 재사용한다. 또박또박이
  // 응답 유실 후 재전송해도 회의가 중복 생성되지 않게 하는 안전망. 복수 매칭은 created_at 최신 1건.
  const { data: dup, error: dupErr } = await admin
    .from('meetings').select('id')
    .eq('project_id', m.projectId).eq('meeting_date', m.date).eq('title', m.title)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (dupErr) {
    console.error('[minutes-api] 회의 dedup 조회 실패:', dupErr.message)
    return fail500
  }
  if (dup) return { ok: true, meetingId: dup.id as string, projectId: m.projectId, created: false }

  // 고정 속성(v2.5 §4.2) — 외부 API 는 항상 단발(recurrence none)·참석자 없는 회의만 만든다.
  const { data: created, error: insErr } = await admin
    .from('meetings')
    .insert({
      project_id: m.projectId,
      title: m.title,
      meeting_date: m.date,
      category: m.category,
      body: '',
      recurrence: 'none',
      recurrence_until: null,
      start_time: null,
      end_time: null,
      location: null,
      created_by: user.id,
      created_by_name: user.name,
    })
    .select('id')
    .single()
  if (insErr || !created) {
    console.error('[minutes-api] 회의 생성 실패:', insErr?.message ?? 'no row')
    return fail500
  }
  // 내부 회의 화면 캐시 갱신 — actions/meetings.ts revalidateMeetings 와 동일 경로.
  revalidatePath(`/p/${m.projectId}/meetings`)
  revalidatePath('/meetings')
  return { ok: true, meetingId: created.id as string, projectId: m.projectId, created: true }
}
