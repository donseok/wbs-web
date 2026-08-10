/** DEPRECATED — 깊이 판정에 쓰지 않는다(진실은 parent_id 트리). 프로젝트별 레벨 라벨은 ProjectConfig.levelLabels. */
export type Level = string
/** 팀 코드 — 런타임 기준은 DB teams 마스터(관리자 화면에서 추가/비활성). 컴파일 타임 유니언 금지. */
export type TeamCode = string
export type OwnerKind = 'primary' | 'support'
export type Status = 'not_started' | 'in_progress' | 'delayed' | 'done'
export type DependencyType = 'FS' | 'SS'

/** 로그인 사용자의 팀/역할 멤버십 (getMembership 반환 단위) */
export interface Membership {
  role: string
  teamCode: TeamCode
  teamId: string
}

export interface WbsRow {
  id: string
  parentId: string | null
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
  /** 담당별 자동 분리(sub-act) 항목 여부. 레벨·이름이 아니라 이 플래그가 판별 근거(스펙 §5.2). */
  isOwnerSplit: boolean
}

/** WBS 작업 간 일정 의존성. predecessor → successor 방향. */
export interface TaskDependency {
  id: string
  projectId: string
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
}

export interface ComputedItem extends WbsRow {
  plannedPct: number    // 계산값 0~100
  rolledActualPct: number  // leaf=actualPct, 상위=가중 롤업
  achievement: number | null  // rolledActual/planned, planned=0이면 null
  status: Status
  children: ComputedItem[]
  depth: number
}

/* ── 멤버 관리 — 참여 인력 명단(project_members). 권한 체계가 아니다. ── */
/**
 * 명단상의 구분(화면 표기: 리더 / 실무)이다. **권한이 아니다.**
 * 이 프로젝트에서 무엇을 할 수 있는지는 `project_roles`(admin|member, 행 부재=조회 전용)와
 * `memberships.is_superuser` 가 결정한다 — `@/lib/domain/authz` 를 볼 것.
 * DB 값이 'admin' 인 것은 0003 의 잔재이며 값을 바꾸지 않고 표시만 분리했다.
 */
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
  minutesView?: 'list' | 'calendar' | 'tree'   // 회의록 보관함 뷰 토글
  minuteFontSize?: number   // 회의록 뷰어 본문 글자크기(px, 12~28)
  minutesExplorerLayout?: 'grid' | 'list'  // 회의록 탐색기 우측 카드 레이아웃
  notifRead?: Record<string, string[]> // 프로젝트 id → 읽음 처리한 알림 id('모두 읽음' 시점 피드)
  lastProjectId?: string    // 전역 회의록·내 회의에서 유지할 최근 프로젝트 탐색 문맥
  lastProjectHref?: string  // 최근 프로젝트에서 마지막으로 방문한 안전한 내부 경로
  wbsHideDone?: boolean     // WBS 완료 숨김 토글 — 전 프로젝트 공통(스펙 2026-08-10-wbs-hide-completed)
}

/* ── 회의록 (minutes) ── */
export interface Minute {
  id: string
  minuteDate: string           // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string               // 목록 조회에선 ''
  meetingId: string | null
  projectId?: string | null          // Wiki 귀속 프로젝트(회의 연결 없이도 지정 가능)
  projectName?: string | null        // 목록/상세 표시용 프로젝트명
  meetingOccurrenceDate?: string | null // 반복 회의의 실제 개최일
  meetingProjectId?: string | null  // 연결된 회의의 프로젝트(meetings 조인) — 회의 달력 링크 대상
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  archivedAt?: string | null       // 보관본은 직접/Wiki 근거 링크에서 읽기 전용으로 열 수 있음
  fileCount?: number           // 목록 뷰 전용(첨부 수, 서버 계산)
  bodyPreview?: string              // 카드 요약(0039 생성 컬럼, 목록/트리 조회 전용)
  meetingCategory?: MeetingCategory | null  // 연결 회의 유형(meetings 임베드, 미연결 null)
  folderId?: string | null  // 소속 폴더(0040, 목록 조회 전용 — null=미분류)
  /** 외부 연동 멱등 키(또박또박 `ddobak:<uuid>`, opaque — 파싱 금지). 상세 조회 전용 — null=연동 없음. */
  externalId?: string | null
}

/* ── 탐색기 v2: 실제 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md) ── */

export interface MinuteFolder {
  id: string
  name: string
  parentId: string | null
  sort: number
  createdBy: string | null           // null = 시드 폴더(pmo_admin 만 관리)
}

/** 탐색기 리프 — 목록 조회 shape 에 폴더 소속 부착. */
export interface ExplorerLeaf {
  id: string
  minuteDate: string                 // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  fileCount: number
  createdBy: string | null           // 이동 버튼 노출 판정(작성자 or pmo_admin)
  createdByName: string | null
  bodyPreview: string
  meetingCategory: MeetingCategory | null
  folderId: string | null            // null = 미분류
  projectId?: string | null          // Wiki 귀속 프로젝트
  projectName?: string | null
  meetingId?: string | null          // 연결된 회의(없으면 null)
  /** 연결 회의가 속한 프로젝트 — 회의 달력 링크 대상. 회의가 지워졌거나 볼 권한이 없으면 null 이라
   *  meetingId 만으로 링크를 만들지 않는다(상세 뷰어와 같은 fail-closed 판정). */
  meetingProjectId?: string | null
}

export interface FolderNode {
  folder: MinuteFolder
  children: FolderNode[]
  directLeaves: ExplorerLeaf[]       // 직계 소속(입력 순서 = 날짜 내림차순)
  totalCount: number                 // 하위 포함 재귀 합계
}

export interface ExplorerData {
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]             // 전 기간 flat, 날짜 내림차순
  total: number
  truncated: boolean
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

/** AI 분류 카테고리 (블록 앵커 공유 모듈과 동일 값 — import 순환 방지 위해 여기 재선언). */
export type InsightKind = 'decision' | 'action' | 'deadline' | 'risk'

export interface MinuteHighlight {
  id: string
  minuteId: string
  blockIndex: number
  blockHash: string
  createdBy: string
  createdByName: string | null
  createdAt: string
}

export interface MinuteInsight {
  id: string
  minuteId: string
  bodyHash: string             // 생성 시점 fnv1a64(body_md) — 신선도 캐시 키
  kind: InsightKind | 'none'   // 'none' = 분석 성공·항목 없음 마커(blockIndex -1)
  label: string
  blockIndex: number
  blockHash: string
}
