/**
 * 챗봇 출처(BotSource.href) 내부 경로의 단일 정본 빌더 — 설계 §11.1/§18.
 *
 * 규칙:
 * - 값이 없는 파라미터(undefined·null·빈 문자열)는 쿼리에서 생략한다.
 * - 경로 세그먼트·쿼리 값은 항상 encodeURIComponent — verifier(isInternalHref)의
 *   decodeURIComponent 검증과 짝을 이룬다.
 * - 파라미터는 화면이 실제 소비하는 것만 계약에 둔다:
 *   wbs `?focus=` · weekly `?week=` · meetings `?focus=&date=`(내 회의 `/meetings` 동일)
 *   attendance `?from=&to=&team=&type=` · announcements `?focus=` · members `?team=`
 *   kanban `?view=&team=`(team은 칸반 검색어 초기값으로 소비) · minutes `/minutes/{id}`
 */

type QueryEntry = [key: string, value: string | null | undefined]

function withQuery(path: string, entries: QueryEntry[]): string {
  const query = entries
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return query ? `${path}?${query}` : path
}

function projectMenuPath(projectId: string, menu: string): string {
  return `/p/${encodeURIComponent(projectId)}/${menu}`
}

export function wbsItemHref(projectId: string, itemId: string): string {
  return withQuery(projectMenuPath(projectId, 'wbs'), [['focus', itemId]])
}

export function weeklyHref(projectId: string, weekStart?: string): string {
  return withQuery(projectMenuPath(projectId, 'weekly'), [['week', weekStart]])
}

export function meetingHref(projectId: string, meetingId?: string, occurrenceDate?: string): string {
  return withQuery(projectMenuPath(projectId, 'meetings'), [
    ['focus', meetingId],
    // 회차 날짜는 대상 회의(focus)가 있을 때만 의미가 있다 — 단독 date는 생략.
    ['date', meetingId ? occurrenceDate : undefined],
  ])
}

export function myMeetingHref(meetingId?: string, occurrenceDate?: string): string {
  return withQuery('/meetings', [
    ['focus', meetingId],
    ['date', meetingId ? occurrenceDate : undefined],
  ])
}

export interface AttendanceHrefFilters {
  from?: string
  to?: string
  team?: string
  type?: string
}

export function attendanceHref(projectId: string, filters: AttendanceHrefFilters = {}): string {
  return withQuery(projectMenuPath(projectId, 'attendance'), [
    ['from', filters.from],
    ['to', filters.to],
    ['team', filters.team],
    ['type', filters.type],
  ])
}

export function announcementHref(projectId: string, announcementId?: string): string {
  return withQuery(projectMenuPath(projectId, 'announcements'), [['focus', announcementId]])
}

export function membersHref(projectId: string, team?: string): string {
  return withQuery(projectMenuPath(projectId, 'members'), [['team', team]])
}

export interface KanbanHrefFilters {
  view?: string
  team?: string
}

export function kanbanHref(projectId: string, filters: KanbanHrefFilters = {}): string {
  return withQuery(projectMenuPath(projectId, 'kanban'), [
    ['view', filters.view],
    ['team', filters.team],
  ])
}

export function minuteHref(minuteId: string): string {
  return `/minutes/${encodeURIComponent(minuteId)}`
}

export function dashboardHref(projectId: string): string {
  return projectMenuPath(projectId, 'dashboard')
}

export function settingsHref(projectId: string): string {
  return projectMenuPath(projectId, 'settings')
}
