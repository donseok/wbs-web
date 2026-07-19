import type {
  AnnouncementCategory,
  AttendanceType,
  Meeting,
  MeetingAttendeeInfo,
  MeetingException,
  ProjectMemberRole,
  TaskDependency,
  TeamCode,
  WbsRow,
} from '@/lib/domain/types'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

/**
 * Repository callers must be able to distinguish a valid empty result from a
 * failed query.  Supabase/MySQL-specific error objects deliberately do not
 * cross this boundary.
 */
export type RepositoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: RepositoryErrorCode; retryable: boolean }

export type RepositoryErrorCode =
  | 'WBS_PROJECT_READ_FAILED'
  | 'WBS_ITEMS_READ_FAILED'
  | 'WBS_HOLIDAYS_READ_FAILED'
  | 'WBS_DEPENDENCIES_READ_FAILED'
  | 'WBS_ITEM_SCOPE_READ_FAILED'
  | 'WBS_CHANGE_LOG_READ_FAILED'
  | 'WBS_CHANGE_LOG_ACTORS_READ_FAILED'
  | 'WBS_ATTACHMENTS_READ_FAILED'
  | 'WEEKLY_REPORT_READ_FAILED'
  | 'WEEKLY_ROWS_READ_FAILED'
  | 'MEETINGS_READ_FAILED'
  | 'MEETING_EXCEPTIONS_READ_FAILED'
  | 'MEETING_DETAIL_READ_FAILED'
  | 'MEETING_ATTENDEES_READ_FAILED'
  | 'MY_MEETING_MEMBER_LINKS_READ_FAILED'
  | 'MY_MEETINGS_READ_FAILED'
  | 'MY_MEETING_EXCEPTIONS_READ_FAILED'
  | 'ATTENDANCE_READ_FAILED'
  | 'ATTENDANCE_MEMBER_SCOPE_INVALID'
  | 'ANNOUNCEMENTS_READ_FAILED'
  | 'MINUTES_READ_FAILED'
  | 'MINUTE_DETAIL_READ_FAILED'
  | 'MINUTE_INSIGHTS_READ_FAILED'
  | 'MINUTE_FILES_READ_FAILED'
  | 'MEMBERS_READ_FAILED'
  | 'PROJECT_SETTINGS_READ_FAILED'
  | 'PROJECT_HOLIDAYS_READ_FAILED'
  | 'PROJECT_SETTINGS_COUNTS_READ_FAILED'

export function repositoryOk<T>(data: T): RepositoryResult<T> {
  return { ok: true, data }
}

export function repositoryError<T>(
  errorCode: RepositoryErrorCode,
  retryable: boolean,
): RepositoryResult<T> {
  return { ok: false, errorCode, retryable }
}

export interface WbsRepositoryItem extends WbsRow {
  projectId: string
  /** Real source update time. It is never replaced with a creation time. */
  updatedAt: string | null
}

export interface WbsProjectSnapshot {
  projectId: string
  baseDate: string | null
  items: WbsRepositoryItem[]
  holidays: string[]
  dependencies: TaskDependency[]
}

export type WbsChangeField =
  | 'actual_pct'
  | 'weight'
  | 'created'
  | 'name'
  | 'planned_start'
  | 'planned_end'
  | 'deliverable'
  | 'biz'
  | 'dependency'

/** Raw auth user IDs never cross this contract. */
export interface WbsChangeLogRecord {
  id: number
  wbsItemId: string
  field: WbsChangeField
  oldValue: string | null
  newValue: string | null
  changedAt: string
  actorLabel: string | null
  actorTeam: TeamCode | null
  actorRole: string | null
}

export interface WbsChangeLogSnapshot {
  itemId: string
  itemCode: string
  itemName: string
  itemUpdatedAt: string | null
  entries: WbsChangeLogRecord[]
  truncated: boolean
}

/** Storage paths, uploader IDs, signed URLs, and file contents are intentionally absent. */
export interface WbsAttachmentMetadataRecord {
  id: string
  wbsItemId: string
  fileName: string
  size: number | null
  mime: string | null
  createdAt: string
}

export interface WbsAttachmentMetadataSnapshot {
  itemId: string
  itemCode: string
  itemName: string
  itemUpdatedAt: string | null
  attachments: WbsAttachmentMetadataRecord[]
  truncated: boolean
}

export interface WbsRepository {
  /** null means the project itself was not visible/found; [] items is valid. */
  getProjectSnapshot(projectId: string): Promise<RepositoryResult<WbsProjectSnapshot | null>>
}

export interface WbsSupplementalRepository {
  /** projectId is verified before an item ID can be used to read audit rows. */
  getChangeLog(
    projectId: string,
    itemId: string,
    limit: number,
  ): Promise<RepositoryResult<WbsChangeLogSnapshot | null>>
  /** Metadata-only SELECT. Implementations must never call object storage. */
  listAttachmentMetadata(
    projectId: string,
    itemId: string,
    limit: number,
  ): Promise<RepositoryResult<WbsAttachmentMetadataSnapshot | null>>
}

export interface WbsBotRepository extends WbsRepository, WbsSupplementalRepository {}

export interface WeeklyReportRecord {
  id: string
  projectId: string
  weekStart: string
  title: string
  updatedAt: string | null
}

export interface WeeklyRepositoryRow extends WeeklySheetRow {
  updatedAt: string | null
}

export interface WeeklySheetSnapshot {
  report: WeeklyReportRecord
  rows: WeeklyRepositoryRow[]
}

export interface WeeklyRepository {
  /** Pure read. A missing report is a successful null result. */
  getSheet(projectId: string, weekStart: string): Promise<RepositoryResult<WeeklySheetSnapshot | null>>
}

export interface ProjectMeetingSnapshot {
  meetings: Meeting[]
  exceptions: MeetingException[]
}

/** Email is intentionally omitted from the chatbot repository contract. */
export type SafeMeetingAttendee = Omit<MeetingAttendeeInfo, 'email'>

export interface MeetingDetailSnapshot {
  meeting: Meeting
  attendees: SafeMeetingAttendee[]
  exceptions: MeetingException[]
}

export type MyMeetingRelation = 'creator' | 'attendee' | 'creator_and_attendee'

export interface MyMeetingRepositoryRecord extends Meeting {
  projectName: string | undefined
  isMine: true
  mineBy: MyMeetingRelation
}

export interface MyMeetingSnapshot {
  meetings: MyMeetingRepositoryRecord[]
  exceptions: MeetingException[]
}

export interface MeetingRepository {
  listProjectMeetings(
    projectId: string,
    from: string,
    to: string,
  ): Promise<RepositoryResult<ProjectMeetingSnapshot>>
  /** projectId is part of the predicate so an arbitrary entity ID cannot cross scope. */
  getMeetingDetail(
    projectId: string,
    meetingId: string,
  ): Promise<RepositoryResult<MeetingDetailSnapshot | null>>
}

export interface MyMeetingRepository {
  /**
   * Resolves the authenticated user's project-member links and returns only
   * meetings they created or attend inside the supplied project allowlist.
   */
  listMyMeetings(
    userId: string,
    allowedProjectIds: readonly string[],
    from: string,
    to: string,
  ): Promise<RepositoryResult<MyMeetingSnapshot>>
}

export interface MeetingBotRepository extends MeetingRepository, MyMeetingRepository {}

export interface AttendanceRepositoryRecord {
  id: string
  projectId: string
  memberId: string
  memberName: string
  teamCode: TeamCode | null
  date: string
  type: AttendanceType
  /** No note field by design: attendance notes are out of scope for Phase 1. */
}

export interface AttendanceRepository {
  listRecords(
    projectId: string,
    from: string,
    to: string,
  ): Promise<RepositoryResult<AttendanceRepositoryRecord[]>>
}

/** 공지 — body는 장문 검색 대상이라 포함하되, 읽음 처리(announcement_seen)는 절대 건드리지 않는다. */
export interface AnnouncementRepositoryRecord {
  id: string
  projectId: string
  title: string
  body: string
  category: AnnouncementCategory
  isPinned: boolean
  publishFrom: string | null
  publishTo: string | null
  createdAt: string
  updatedAt: string | null
}

export interface AnnouncementListSnapshot {
  records: AnnouncementRepositoryRecord[]
  truncated: boolean
}

export interface AnnouncementRepository {
  /** SELECT 전용. 챗봇 조회가 읽음 워터마크를 갱신하면 안 된다. */
  listAnnouncements(projectId: string, limit: number): Promise<RepositoryResult<AnnouncementListSnapshot>>
}

/** 회의록 — Storage 경로(file_path)·signed URL은 계약 타입에 존재하지 않는다. */
export interface MinuteRepositoryRecord {
  id: string
  minuteDate: string
  teamCode: TeamCode
  title: string
  meetingId: string | null
  /** meeting 역참조로 얻은 프로젝트. 회의 미연결 회의록은 null(전역). */
  meetingProjectId: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string | null
}

export interface MinuteSearchSnapshot {
  records: MinuteRepositoryRecord[]
  truncated: boolean
}

export interface MinuteFileMetadataRecord {
  fileName: string
  size: number | null
  mime: string | null
  createdAt: string
}

export interface MinuteInsightRecord {
  kind: string
  label: string
  blockIndex: number
}

export interface MinuteDetailSnapshot {
  minute: MinuteRepositoryRecord & { bodyMd: string }
  insights: MinuteInsightRecord[]
  files: MinuteFileMetadataRecord[]
}

export interface MinutesRepository {
  searchMinutes(input: {
    query: string | null
    team: TeamCode | null
    /** 지정 시 meeting 역참조 프로젝트로 필터 — 회의 미연결 회의록은 제외된다. */
    projectId: string | null
    from: string | null
    to: string | null
    limit: number
  }): Promise<RepositoryResult<MinuteSearchSnapshot>>
  getMinuteDetail(minuteId: string): Promise<RepositoryResult<MinuteDetailSnapshot | null>>
}

/** 멤버 — email 필드는 계약에서 의도적으로 제외(챗봇 민감정보 정책). */
export interface MemberRepositoryRecord {
  id: string
  projectId: string
  name: string
  teamCode: TeamCode | null
  role: ProjectMemberRole
  title: string | null
  hasAccount: boolean
  createdAt: string
}

export interface MemberRepository {
  listMembers(projectId: string): Promise<RepositoryResult<MemberRepositoryRecord[]>>
}

/** 설정 — 프로젝트 운영 정보만. 환경변수·키·계정 정보는 계약에 존재하지 않는다. */
export interface ProjectSettingsSnapshot {
  projectId: string
  name: string
  startDate: string | null
  endDate: string | null
  baseDate: string | null
  holidays: string[]
  wbsItemCount: number
  memberCount: number
  updatedAt: string | null
}

export interface ProjectSettingsRepository {
  /** null은 프로젝트 자체가 안 보임/없음. 부속 카운트 실패는 별도 에러 코드로 구분한다. */
  getSafeSettings(projectId: string): Promise<RepositoryResult<ProjectSettingsSnapshot | null>>
}

export interface CoreBotRepositories {
  wbs: WbsBotRepository
  weekly: WeeklyRepository
  meetings: MeetingBotRepository
  attendance: AttendanceRepository
  announcements: AnnouncementRepository
  minutes: MinutesRepository
  members: MemberRepository
  settings: ProjectSettingsRepository
}
