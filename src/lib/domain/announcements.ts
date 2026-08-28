import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'
import { diffDaysCal, type MilestonePoint } from './dashboard'

/**
 * 카테고리 메타 — 라벨은 dict 키(표시 지점에서 t()로 해석), 색상은 상태 팔레트
 * 재사용으로 라이트·다크 자동 대응. (ATTENDANCE_META/roleMeta 관례)
 */
export const ANNOUNCEMENT_META: Record<
  AnnouncementCategory,
  { labelKey: `ann.cat.${AnnouncementCategory}`; chip: string; dot: string }
> = {
  general:   { labelKey: 'ann.cat.general',   chip: 'bg-brand-weak text-brand',       dot: 'bg-brand' },
  important: { labelKey: 'ann.cat.important', chip: 'bg-delayed-weak text-delayed',   dot: 'bg-delayed' },
  event:     { labelKey: 'ann.cat.event',     chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
}

/** 카테고리 표시 순서 (필터 탭/폼 셀렉트용) */
export const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ['general', 'important', 'event']

/** 고정 우선 → 최신순. 원본을 변형하지 않는다. */
export function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
}

/** 게시 상태 라벨(dict 키)·칩 색상 — ANNOUNCEMENT_META 관례. active 는 배지 없이 노출. */
export type AnnouncementStatus = 'scheduled' | 'active' | 'expired'
export const ANNOUNCEMENT_STATUS_META: Record<
  AnnouncementStatus,
  { labelKey: `ann.status.${AnnouncementStatus}`; chip: string }
> = {
  scheduled: { labelKey: 'ann.status.scheduled', chip: 'bg-pending-weak text-accent-warning' },
  active:    { labelKey: 'ann.status.active',    chip: 'bg-progress-weak text-progress' },
  expired:   { labelKey: 'ann.status.expired',   chip: 'bg-line text-ink-subtle' },
}

/**
 * 게시 기간 대비 오늘(todayIso, 'YYYY-MM-DD' KST) 위치.
 * date 문자열은 'YYYY-MM-DD' 사전식 비교가 시간순과 일치한다. from/to null = 무기한 경계.
 */
export function announcementStatus(a: Announcement, todayIso: string): AnnouncementStatus {
  if (a.publishFrom && todayIso < a.publishFrom) return 'scheduled'
  if (a.publishTo && todayIso > a.publishTo) return 'expired'
  return 'active'
}

/** 오늘 노출 대상인가(게시중). 일반 사용자 목록·티커·대시보드 필터에 쓴다. */
export function isPublishedNow(a: Announcement, todayIso: string): boolean {
  return announcementStatus(a, todayIso) === 'active'
}

/** 워터마크(마지막으로 목록을 본 시각) 이후 생성된 공지인가. null 워터마크 = 전부 안읽음. */
export function isUnread(a: Announcement, lastSeenAt: string | null): boolean {
  if (lastSeenAt === null) return true
  return Date.parse(a.createdAt) > Date.parse(lastSeenAt)
}

export function countUnread(items: Announcement[], lastSeenAt: string | null): number {
  return items.filter((a) => isUnread(a, lastSeenAt)).length
}

const DAY = 86_400_000

/**
 * KPI 집계 — recent7d는 todayIso('YYYY-MM-DD', Asia/Seoul) 포함 직전 7일.
 * 목록의 날짜 표기(fmtDate, Asia/Seoul)와 일치하도록 KST(+09:00) 자정을 경계로 쓴다.
 */
export function summarizeAnnouncements(
  items: Announcement[],
  todayIso: string,
): { total: number; pinned: number; recent7d: number } {
  const cutoff = Date.parse(`${todayIso}T00:00:00+09:00`) - 6 * DAY
  let pinned = 0
  let recent7d = 0
  for (const a of items) {
    if (a.isPinned) pinned++
    if (Date.parse(a.createdAt) >= cutoff) recent7d++
  }
  return { total: items.length, pinned, recent7d }
}

export interface MeetingAnnouncementSource {
  title: string
  occurrenceDate: string
  startTime: string | null
  endTime: string | null
  location: string | null
  body: string
}

/**
 * 회의 1회차를 공지 입력으로 변환(원클릭 등록용). 본문은 평문으로 조합해 DB에
 * 그대로 저장한다(뷰어 언어 재번역 없음 → 한글 라벨 고정). 게시기간은
 * 오늘~max(오늘, 회차일)로, 과거 회차도 publishFrom>publishTo 위반이 나지 않게 한다.
 */
export function composeAnnouncementFromMeeting(
  src: MeetingAnnouncementSource,
  todayIso: string,
): { title: string; body: string; category: AnnouncementCategory; isPinned: boolean; publishFrom: string; publishTo: string } {
  const timePart = src.startTime === null
    ? '(종일)'
    : src.endTime
      ? `${src.startTime}–${src.endTime}`
      : src.startTime
  const lines = [`일시: ${src.occurrenceDate} ${timePart}`]
  if (src.location && src.location.trim()) lines.push(`장소: ${src.location.trim()}`)
  const head = lines.join('\n')
  const note = src.body.trim()
  const body = note ? `${head}\n\n${note}` : head
  return {
    title: src.title,
    body,
    category: 'general',
    isPinned: false,
    publishFrom: todayIso,
    // 'YYYY-MM-DD'는 사전식 비교가 시간순과 일치 — 더 늦은 날짜가 max
    publishTo: src.occurrenceDate > todayIso ? src.occurrenceDate : todayIso,
  }
}

/* ── 공지 입력 검증(서버 액션·폼 공용, 순수) ── */
export interface AnnouncementInput {
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
  publishFrom: string // 'YYYY-MM-DD' (KST) 게시 시작일 · 필수
  publishTo: string   // 'YYYY-MM-DD' (KST) 게시 종료일(포함) · 필수
  /** 마일스톤 타임라인 날짜 — null = 표시 안 함. '' 은 "체크했는데 날짜 없음"이라 거부한다. */
  milestoneDate: string | null
}

export const ANNOUNCEMENT_TITLE_MAX = 200
export const ANNOUNCEMENT_BODY_MAX = 20000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' 형식 + 실재하는 날짜인지 (2026-02-30 등 반려) */
export function isValidYmd(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 저장 전 입력 검증 — 통과면 null, 아니면 사용자에게 보일 사유(한국어, 액션 관례). */
export function validateAnnouncementInput(input: AnnouncementInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return `제목은 ${ANNOUNCEMENT_TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > ANNOUNCEMENT_BODY_MAX) return `본문은 ${ANNOUNCEMENT_BODY_MAX}자 이하여야 합니다.`
  if (!ANNOUNCEMENT_CATEGORIES.includes(input.category)) return '잘못된 카테고리입니다.'
  if (!input.publishFrom || !input.publishTo) return '게시 시작일과 종료일을 모두 지정하세요.'
  if (!isValidYmd(input.publishFrom) || !isValidYmd(input.publishTo)) return '게시 기간 날짜 형식이 올바르지 않습니다.'
  if (input.publishFrom > input.publishTo) return '게시 종료일은 시작일보다 빠를 수 없습니다.'
  if (input.milestoneDate !== null) {
    if (!input.milestoneDate) return '마일스톤 일자를 지정하세요.'
    if (!isValidYmd(input.milestoneDate)) return '마일스톤 일자 형식이 올바르지 않습니다.'
  }
  return null
}

/* ── 마일스톤 타임라인 점(0091) ── */

/**
 * milestoneDate 가 있는 공지 → 타임라인 점. 지난 행사는 'done'(치러진 것 — WBS 의 '경과'와 다르다),
 * 오늘 이후는 'upcoming' + D-N. today 는 호출부가 타임라인의 시계(WBS 와 같은 today)를 넘긴다 —
 * 한 카드 안에서 오늘 선·D-day 가 한 시계를 쓰게.
 */
export function announcementMilestones(items: Announcement[], today: string): MilestonePoint[] {
  return items
    .filter((a): a is Announcement & { milestoneDate: string } => !!a.milestoneDate)
    .map(a => ({
      id: a.id, name: a.title, date: a.milestoneDate, kind: 'announcement' as const,
      status: a.milestoneDate < today ? 'done' as const : 'upcoming' as const,
      dday: diffDaysCal(today, a.milestoneDate),
    }))
}

/** WBS 점 + 공지 점을 날짜순으로 — 같은 날짜면 입력 순서(WBS 먼저) 유지(안정 정렬). */
export function mergeMilestonePoints(wbs: MilestonePoint[], announcements: MilestonePoint[]): MilestonePoint[] {
  return [...wbs, ...announcements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
