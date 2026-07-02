export type Level = 'phase' | 'task' | 'activity'
export type TeamCode = 'PMO' | 'DT' | 'ERP' | 'MES'
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
 * work=정상근무 remote=재택 annual=연차 half=반차 sick=병가
 * trip=출장 official=공가 absent=결근 */
export type AttendanceType =
  | 'work' | 'remote' | 'annual' | 'half' | 'sick' | 'trip' | 'official' | 'absent'
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
