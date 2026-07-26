import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { fnv1a64 } from '@/lib/minutes/blocks'

export type MinuteVersionFile = {
  fileName: string
  filePath: string
  size: number
  mime: string
}

export type AppendMinuteVersionInput = {
  minuteId: string
  bodyMd: string
  createdBy: string | null
  createdByName: string | null
  file?: MinuteVersionFile | null
  metadata?: {
    title: string
    minuteDate: string
    teamCode: string
    meetingId: string | null
    projectId: string | null
    meetingOccurrenceDate: string | null
  }
}

export type AppendedMinuteVersion = {
  id: string
  versionNo: number
  bodyHash: string
}

/**
 * 회의록 본문을 append-only 버전으로 남긴다.
 *
 * version_no 계산과 insert 사이의 동시 갱신은 UNIQUE(minute_id, version_no)에 맡기고
 * 충돌하면 최신 번호를 다시 읽어 최대 3회 재시도한다. 호출부는 이 함수가 실패한 상태에서
 * current body를 바꾸면 안 된다.
 */
export async function appendMinuteVersion(
  db: SupabaseClient,
  input: AppendMinuteVersionInput,
): Promise<{ version: AppendedMinuteVersion | null; error: string | null }> {
  const bodyHash = fnv1a64(input.bodyMd)
  let metadata = input.metadata
  if (!metadata) {
    const { data: minute, error: minuteError } = await db.from('minutes')
      .select('title, minute_date, team_code, meeting_id, project_id, meeting_occurrence_date')
      .eq('id', input.minuteId)
      .maybeSingle()
    if (minuteError || !minute) {
      return { version: null, error: minuteError?.message ?? '회의록 메타데이터를 찾을 수 없습니다.' }
    }
    metadata = {
      title: minute.title as string,
      minuteDate: minute.minute_date as string,
      teamCode: minute.team_code as string,
      meetingId: (minute.meeting_id as string | null) ?? null,
      projectId: (minute.project_id as string | null) ?? null,
      meetingOccurrenceDate: (minute.meeting_occurrence_date as string | null) ?? null,
    }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: latest, error: latestError } = await db.from('minute_versions')
      .select('version_no')
      .eq('minute_id', input.minuteId)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestError) return { version: null, error: latestError.message }

    const versionNo = ((latest?.version_no as number | undefined) ?? 0) + 1
    const { data, error } = await db.from('minute_versions').insert({
      minute_id: input.minuteId,
      version_no: versionNo,
      body_md: input.bodyMd,
      body_hash: bodyHash,
      file_name: input.file?.fileName ?? null,
      file_path: input.file?.filePath ?? null,
      file_size: input.file?.size ?? null,
      file_mime: input.file?.mime ?? null,
      created_by: input.createdBy,
      created_by_name: input.createdByName,
      title: metadata.title,
      minute_date: metadata.minuteDate,
      team_code: metadata.teamCode,
      meeting_id: metadata.meetingId,
      project_id: metadata.projectId,
      meeting_occurrence_date: metadata.meetingOccurrenceDate,
    }).select('id, version_no, body_hash').single()

    if (!error && data) {
      return {
        version: {
          id: data.id as string,
          versionNo: data.version_no as number,
          bodyHash: data.body_hash as string,
        },
        error: null,
      }
    }
    if (error?.code !== '23505') return { version: null, error: error?.message ?? '버전 기록 실패' }
  }
  return { version: null, error: '동시 갱신으로 버전 기록에 실패했습니다. 다시 시도하세요.' }
}

/**
 * 0045 이전 데이터나 부분 실패 데이터를 위한 안전망. 최신 버전의 해시가 현재 본문과
 * 같을 때만 그 버전을 재사용한다. 버전이 없거나 현재 본문과 다른 경우에는 현재 본문을
 * 새 버전으로 append해, 부분 적용으로 생긴 변경분도 잃지 않는다.
 */
export async function ensureCurrentMinuteVersion(
  db: SupabaseClient,
  input: AppendMinuteVersionInput,
): Promise<{ version: AppendedMinuteVersion | null; error: string | null }> {
  const { data, error } = await db.from('minute_versions')
    .select('id, version_no, body_hash')
    .eq('minute_id', input.minuteId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { version: null, error: error.message }
  const currentBodyHash = fnv1a64(input.bodyMd)
  if (data && data.body_hash === currentBodyHash) {
    return {
      version: {
        id: data.id as string,
        versionNo: data.version_no as number,
        bodyHash: data.body_hash as string,
      },
      error: null,
    }
  }
  return appendMinuteVersion(db, input)
}
