export type Level = 'phase' | 'task' | 'activity'
export type TeamCode = 'PMO' | 'ERP' | 'MES' | '가공'
export type OwnerKind = 'primary' | 'support'
export type Status = 'not_started' | 'in_progress' | 'delayed' | 'done'

/** 로그인 사용자의 팀/역할 멤버십 (getMembership 반환 단위) */
export interface Membership {
  role: string
  teamCode: TeamCode
  teamId: string
}

export interface WbsRow {
  id: string
  parentId: string | null
  level: Level
  code: string
  sortOrder: number
  name: string
  biz: string | null
  deliverable: string | null
  plannedStart: string | null   // 'YYYY-MM-DD'
  plannedEnd: string | null
  weight: number | null         // null이면 형제 균등
  actualPct: number | null      // leaf만 의미 있음, 0~100
  owners: { team: TeamCode; kind: OwnerKind }[]
}

export interface ComputedItem extends WbsRow {
  plannedPct: number    // 계산값 0~100
  rolledActualPct: number  // leaf=actualPct, 상위=가중 롤업
  achievement: number | null  // rolledActual/planned, planned=0이면 null
  status: Status
  children: ComputedItem[]
}

/* ── 멤버 관리 ── */
export type ProjectMemberRole = 'admin' | 'contributor'
export interface ProjectMember {
  id: string
  projectId: string
  name: string
  email: string | null
  teamCode: TeamCode | null
  role: ProjectMemberRole
  title: string | null      // 직함/역할 설명
  hasAccount: boolean       // 로그인 계정(auth.users)과 연결됨. auth uuid 자체는 클라이언트로 보내지 않는다
  createdAt: string
}

/* ── 산출물 첨부 ── */
export interface DeliverableAttachment {
  id: string
  wbsItemId: string
  fileName: string
  filePath: string
  size: number | null
  mime: string | null
  createdAt: string
  url?: string | null      // 서명 URL(읽기 시 생성)
}

/* ── 근태현황 ──
 * work=정상근무 annual=연차 half=반차 quarter=반반차 sick=병가 trip=출장
 * (remote=재택 official=공가 absent=결근 은 등록 옵션에서 제외 — 과거 기록 표시용으로만 타입 유지) */
export type AttendanceType =
  | 'work' | 'remote' | 'annual' | 'half' | 'quarter' | 'sick' | 'trip' | 'official' | 'absent'
export interface AttendanceRecord {
  id: string
  projectId: string
  memberId: string
  date: string              // 'YYYY-MM-DD'
  type: AttendanceType
  note: string | null
}

/* ── 공지사항 ── */
export type AnnouncementCategory = 'general' | 'important' | 'event'
export interface Announcement {
  id: string
  projectId: string
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
  publishFrom: string | null // 'YYYY-MM-DD' (KST) 게시 시작일 · null = 무기한
  publishTo: string | null   // 'YYYY-MM-DD' (KST) 게시 종료일(포함) · null = 무기한
  createdAt: string          // ISO timestamptz
  updatedAt: string
}
/** 헤더 티커 등 제목 표시용 최소 shape — body 전문을 실어 나르지 않는다. */
export interface AnnouncementSummary {
  id: string
  title: string
  category: AnnouncementCategory
  isPinned: boolean
}

/* ── 회의 (meetings) ── */
export type MeetingCategory = 'general' | 'routine' | 'kickoff' | 'review' | 'report' | 'external'
export type MeetingRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Meeting {
  id: string
  projectId: string
  title: string
  meetingDate: string          // 'YYYY-MM-DD' — 시리즈 앵커(첫 회차)
  startTime: string | null     // 'HH:MM' 또는 null(종일)
  endTime: string | null       // 'HH:MM' 또는 null
  location: string | null
  category: MeetingCategory
  body: string                 // 회의록/메모 (목록 조회에선 '')
  recurrence: MeetingRecurrence
  recurrenceUntil: string | null // 'YYYY-MM-DD' 포함(inclusive)
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  attendeeIds: string[]        // project_members.id (시리즈 단위)
  projectName?: string         // 내 회의 뷰 전용(크로스 프로젝트 표시)
  isMine?: boolean             // 내 회의 뷰 전용(서버 계산)
}

export interface MeetingException {
  meetingId: string
  occurrenceDate: string       // 'YYYY-MM-DD'
  kind: 'cancelled'
}

/** 달력 셀·칩이 필요로 하는 전개된 1회차. body/참석자이름은 상세 모달에서 별도 로드. */
export interface MeetingOccurrence {
  occurrenceId: string         // `${seriesId}:${occurrenceDate}` — React key & 회차 식별
  seriesId: string             // = Meeting.id
  occurrenceDate: string       // 'YYYY-MM-DD'
  projectId: string
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  category: MeetingCategory
  isRecurring: boolean
  attendeeCount: number
  projectName?: string
  isMine?: boolean
}

/** 상세 모달용 참석자 표시 정보 */
export interface MeetingAttendeeInfo {
  id: string                   // project_members.id
  name: string
  teamCode: TeamCode | null
  email: string | null
}

/** 계정별로 동기화되는 전역 UI 설정. 각 키는 서버에 없을 수 있음(부분 저장). */
export interface UiPrefs {
  heroCollapsed?: boolean
  sidebarCollapsed?: boolean
  theme?: 'light' | 'dark'
  locale?: 'ko' | 'en'
  dashSections?: string[]   // 대시보드 상세 아코디언에서 펼쳐 둔 그룹 id
  minutesView?: 'list' | 'calendar'   // 회의록 보관함 뷰 토글
}

/* ── 회의록 (minutes) ── */
export interface Minute {
  id: string
  minuteDate: string           // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string               // 목록 조회에선 ''
  meetingId: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  fileCount?: number           // 목록 뷰 전용(첨부 수, 서버 계산)
}

export interface MinuteFile {
  id: string
  minuteId: string
  role: 'body' | 'attachment'
  fileName: string
  filePath: string
  size: number | null
  mime: string | null
  createdAt: string
  url?: string | null          // 서명 URL(요청 시 발급)
}
