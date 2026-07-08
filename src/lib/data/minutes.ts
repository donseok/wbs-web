import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { MeetingMinutes, MeetingMinutesDetail, TeamCode } from '@/lib/domain/types'

/** 목록·상세 공통 컬럼. content_md 는 여기에 없다 — 목록이 본문을 읽으면 안 된다. */
const BASE_COLS =
  'id, project_id, team_id, meeting_id, minutes_date, title, file_path, file_name, size, mime, has_md, created_by, created_by_name, created_at'

/** PostgREST embed 는 항상 마지막에 둔다 — 레포의 다른 data/* 셀렉트와 동일한 배치. */
const LIST_COLS = `${BASE_COLS}, teams(code)`
const DETAIL_COLS = `${BASE_COLS}, content_md, teams(code)`

type Row = Record<string, unknown> & { teams?: { code: TeamCode } | { code: TeamCode }[] | null }

/**
 * PostgREST 는 to-one 조인을 객체로 주지만 타입 추론이 배열로 넓어지는 경우가 있어 둘 다 받는다.
 * team_id 가 not null + FK(on delete restrict)이고 teams 의 RLS(read_all_teams)도
 * meeting_minutes 의 read_all_minutes 와 동일하게 "to authenticated using (true)"라
 * 인증된 사용자에게는 이 조인이 비어 있을 수 없다 — 즉 이 분기는 현재 스키마에서는 도달 불가다.
 * 그래도 절대 throw 하지 않는다는 계층 관례상 폴백이 필요해 'PMO'를 쓴다: 어떤 팀을 고르든
 * (이론상) 틀릴 수 있는 값이라 실질적 안전장치는 이 주석이 설명하는 DB 제약이지 폴백 값 자체가 아니다.
 */
function teamCode(r: Row): TeamCode {
  const t = r.teams
  if (!t) return 'PMO'
  return Array.isArray(t) ? t[0].code : t.code
}

function mapMinutes(r: Row): MeetingMinutes {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    teamId: r.team_id as string,
    teamCode: teamCode(r),
    meetingId: (r.meeting_id as string | null) ?? null,
    minutesDate: r.minutes_date as string,
    title: r.title as string,
    filePath: r.file_path as string,
    fileName: r.file_name as string,
    // bigint 은 드라이버/전송 경로에 따라 문자열로 올 수 있고, JS number 의 안전 범위(2^53)도 넘을 수 있다.
    // 타입이 number 라고 선언한 이상 경계에서 한 번 정규화한다. (파일 크기는 안전 범위 안이다.)
    size: r.size == null ? null : Number(r.size),
    mime: (r.mime as string | null) ?? null,
    hasMd: (r.has_md as boolean) ?? false,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

/** 프로젝트 회의록 목록 — 최신 회의일 우선. content_md 제외(무겁다). 실패 시 [] (읽기 계층 관례). */
export const getProjectMinutes = cache(async (projectId: string): Promise<MeetingMinutes[]> => {
  const sb = await createServerClient()
  const { data } = await sb
    .from('meeting_minutes')
    .select(LIST_COLS)
    .eq('project_id', projectId)
    .order('minutes_date', { ascending: false })
    .order('created_at', { ascending: false })
  return (data ?? []).map(r => mapMinutes(r as Row))
})

/** 상세 — content_md 포함. 없거나 RLS 차단이면 null. */
export const getMinutesDetail = cache(async (id: string): Promise<MeetingMinutesDetail | null> => {
  const sb = await createServerClient()
  const { data } = await sb
    .from('meeting_minutes')
    .select(DETAIL_COLS)
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const r = data as Row
  return { ...mapMinutes(r), contentMd: (r.content_md as string | null) ?? null }
})
