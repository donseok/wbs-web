import type { Meeting, MeetingCategory, MeetingException, MeetingOccurrence, MeetingRecurrence } from '@/lib/domain/types'

/**
 * 카테고리 메타 — 라벨은 dict 키(표시 지점에서 t()로 해석), 색상은 상태/팀 팔레트
 * 재사용으로 라이트·다크 자동 대응. (ANNOUNCEMENT_META/ATTENDANCE_META 관례)
 */
export const MEETING_META: Record<
  MeetingCategory,
  { labelKey: `meet.cat.${MeetingCategory}`; chip: string; dot: string }
> = {
  general:  { labelKey: 'meet.cat.general',  chip: 'bg-brand-weak text-brand',                dot: 'bg-brand' },
  routine:  { labelKey: 'meet.cat.routine',  chip: 'bg-progress-weak text-progress',          dot: 'bg-progress' },
  kickoff:  { labelKey: 'meet.cat.kickoff',  chip: 'bg-done-weak text-done',                  dot: 'bg-done' },
  review:   { labelKey: 'meet.cat.review',   chip: 'bg-pending-weak text-pending',            dot: 'bg-pending' },
  report:   { labelKey: 'meet.cat.report',   chip: 'bg-accent-secondary/15 text-accent-secondary', dot: 'bg-accent-secondary' },
  external: { labelKey: 'meet.cat.external', chip: 'bg-delayed-weak text-delayed',            dot: 'bg-delayed' },
}

/** 표시 순서(폼 셀렉트/범례용) */
export const MEETING_CATEGORIES: MeetingCategory[] = ['routine', 'general', 'kickoff', 'review', 'report', 'external']

/** 반복 옵션 표시 순서 */
export const RECURRENCE_ORDER: MeetingRecurrence[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly']

/** 시리즈당 전개 하드캡 — recurrence_until null 이어도 무한 루프 불가(방어선). */
const MAX_OCCURRENCES = 366

function pad2(n: number): string { return String(n).padStart(2, '0') }
function iso(y: number, m0: number, d: number): string { return `${y}-${pad2(m0 + 1)}-${pad2(d)}` }
/** 'YYYY-MM-DD' → UTC epoch day 수(타임존 무관 정수 비교/산술용). */
function epochDay(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}
function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

/**
 * meetings 를 [gridStart, gridEnd] 안의 개별 회차로 전개한다(읽기 시점 전개).
 * - 비반복: meetingDate 가 범위 안이면 1건.
 * - daily/weekly/biweekly: epoch-day 산술로 rangeStart 로 fast-forward 후 step 간격.
 * - monthly: 월 단위로 이동하되 해당 일자가 없는 달(예: 매월 31일의 2월)은 건너뜀(RFC5545/구글 방식).
 * - recurrenceUntil 은 포함(inclusive). cancelled 예외 회차는 제외.
 * - 범위 밖 회차는 절대 방출하지 않으며 시리즈당 MAX_OCCURRENCES 로 캡.
 * 시각은 서울 벽시계 기준 표시 텍스트 — 원격 뷰어용 타임존 변환 없음(의도적 단순화).
 */
export function expandMeetings(
  meetings: Meeting[],
  exceptions: MeetingException[],
  gridStartIso: string,
  gridEndIso: string,
): MeetingOccurrence[] {
  const startDay = epochDay(gridStartIso)
  const endDay = epochDay(gridEndIso)
  const cancelled = new Set(exceptions.filter(e => e.kind === 'cancelled').map(e => `${e.meetingId}:${e.occurrenceDate}`))
  const out: MeetingOccurrence[] = []

  const emit = (m: Meeting, dateIso: string) => {
    if (cancelled.has(`${m.id}:${dateIso}`)) return
    out.push({
      occurrenceId: `${m.id}:${dateIso}`,
      seriesId: m.id,
      occurrenceDate: dateIso,
      projectId: m.projectId,
      title: m.title,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.location,
      category: m.category,
      isRecurring: m.recurrence !== 'none',
      attendeeCount: m.attendeeIds.length,
      projectName: m.projectName,
      isMine: m.isMine,
    })
  }

  for (const m of meetings) {
    const anchor = m.meetingDate
    const untilDay = m.recurrenceUntil ? epochDay(m.recurrenceUntil) : Infinity
    const hardEndDay = Math.min(endDay, untilDay)

    if (m.recurrence === 'none') {
      const d = epochDay(anchor)
      if (d >= startDay && d <= endDay) emit(m, anchor)
      continue
    }

    if (m.recurrence === 'daily' || m.recurrence === 'weekly' || m.recurrence === 'biweekly') {
      const step = m.recurrence === 'daily' ? 1 : m.recurrence === 'weekly' ? 7 : 14
      const anchorDay = epochDay(anchor)
      // rangeStart 로 fast-forward: anchor 이후 첫 회차 >= startDay
      let k = 0
      if (startDay > anchorDay) k = Math.ceil((startDay - anchorDay) / step)
      let cur = anchorDay + k * step
      let count = 0
      while (cur <= hardEndDay && count < MAX_OCCURRENCES) {
        emit(m, addDaysIso(anchor, cur - anchorDay))
        cur += step
        count++
      }
      continue
    }

    // monthly — 앵커 일자를 유지, 없는 달은 skip
    const [ay, am, ad] = anchor.split('-').map(Number)
    let count = 0
    for (let step = 0; count < MAX_OCCURRENCES; step++) {
      const t = new Date(Date.UTC(ay, am - 1 + step, ad))
      // Date.UTC 롤오버 감지: 목표 일자가 그 달에 존재하지 않으면 skip
      // 앵커 일자가 없는 달(예: 매월 31일의 2월)은 건너뛴다. 종료는 아래 유효 회차의
      // d > hardEndDay 브레이크가 보장한다(어떤 일자든 연속 skip은 최대 1~2개월).
      if (t.getUTCDate() !== ad) continue
      const dateIso = iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
      const d = epochDay(dateIso)
      if (d > hardEndDay) break
      if (d >= startDay) { emit(m, dateIso); count++ }
    }
  }

  return out
}

/** 날짜별 버킷팅 */
export function occurrencesByDate(occ: MeetingOccurrence[]): Record<string, MeetingOccurrence[]> {
  const out: Record<string, MeetingOccurrence[]> = {}
  for (const o of occ) (out[o.occurrenceDate] ??= []).push(o)
  return out
}

/** 종일(null start) 먼저 → startTime 오름차순 → title. 원본 불변. */
export function sortOccurrences(occ: MeetingOccurrence[]): MeetingOccurrence[] {
  return [...occ].sort((a, b) => {
    const aAll = a.startTime === null, bAll = b.startTime === null
    if (aAll !== bAll) return aAll ? -1 : 1
    if (a.startTime && b.startTime && a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

/** 편집/삭제/회차취소 권한 — 작성자 본인 또는 pmo_admin. RLS 정책과 동일 식. */
export function canEditMeeting(m: { createdBy: string | null }, userId: string | null, role: string | null): boolean {
  if (!userId) return false
  if (role === 'pmo_admin') return true
  return m.createdBy !== null && m.createdBy === userId
}

/** 회의 시리즈 수정 폼을 바로 여는 딥링크. 대시보드·내 회의처럼 폼에 필요한 프로젝트 멤버 목록이
 *  없는 화면에서 쓴다 — 회의 페이지가 ?focus 로 회차를 찾고 edit=1 이면 폼을 연다. */
export function meetingEditHref(projectId: string, seriesId: string, occurrenceDate?: string | null): string {
  const q = new URLSearchParams({ focus: seriesId, edit: '1' })
  if (occurrenceDate) q.set('date', occurrenceDate)
  return `/p/${projectId}/meetings?${q.toString()}`
}

const DAY = 86_400_000

/** hero KPI — 오늘/향후 7일(오늘 포함)/전체(현재 그리드 전개분 기준). */
export function summarizeMeetings(occ: MeetingOccurrence[], todayIso: string): { today: number; upcoming7d: number; total: number } {
  const t0 = Date.parse(`${todayIso}T00:00:00+09:00`)
  let today = 0, upcoming7d = 0
  for (const o of occ) {
    const d = Date.parse(`${o.occurrenceDate}T00:00:00+09:00`)
    if (o.occurrenceDate === todayIso) today++
    if (d >= t0 && d < t0 + 7 * DAY) upcoming7d++
  }
  return { today, upcoming7d, total: occ.length }
}
