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

/* ── 진척 스냅샷(추세) ── */
export interface ProgressSnapshot {
  id: string
  projectId: string
  capturedOn: string   // 'YYYY-MM-DD'
  actual: number
  planned: number
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
