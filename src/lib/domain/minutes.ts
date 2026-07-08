import type { MeetingMinutes, Membership } from './types'

/** content_md 문자 상한. announcements/meetings 의 BODY_MAX(20000)를 문서 크기에 맞게 확대한 신규 값. */
export const MINUTES_MD_MAX = 500_000
/** 업로드 파일 크기 상한. 레포 선례 없는 신규 값. */
export const MINUTES_FILE_MAX = 20 * 1024 * 1024

const TITLE_MAX = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MD_EXT_RE = /\.(md|markdown)$/i

/** 'YYYY-MM-DD' 형식 + 실재하는 날짜인지 (2026-02-30 등 반려). announcements.ts:isValidDate 와 동일. */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * 마크다운 파일인가. **확장자만** 본다.
 * DB 의 minutes_md_only 체크제약이 file_path ~* '\.(md|markdown)$' 를 요구하므로,
 * mime 이 text/markdown 이라는 이유로 .txt 파일에 content_md 를 채우면 insert 가 제약에 걸린다.
 * 판정 기준을 한 곳(확장자)으로 고정해 DB 와 앱이 어긋날 수 없게 한다.
 */
export function isMarkdownFile(fileName: string): boolean {
  return MD_EXT_RE.test(fileName)
}

/**
 * Storage 키에 안전한 파일명. RowDetailPanel.tsx:324 와 같은 정규식 + 빈/의미없는 결과 방어.
 * 구분자(., -, _)만 남은 결과는 실질 콘텐츠가 없는 것과 같다 —
 * 예) '///' 는 연속 비허용 문자 뭉치라 정규식이 '_' 하나로 뭉개고, '..' 는 원래부터 구분자뿐이다.
 * 둘 다 경로 세그먼트로 쓰기엔 무의미하므로(전자는 무정보, 후자는 '..' 트래버설 위험) 'file' 로 치환한다.
 */
export function sanitizeFileName(name: string): string {
  const safe = name.replace(/[^\w.\-가-힣]+/g, '_')
  if (!safe || /^[.\-_]+$/.test(safe)) return 'file'
  return safe
}

/**
 * Storage 객체 키. nowMs 주입으로 결정적(테스트 가능) + 동명 파일 충돌 회피 → upsert:false 유지 가능.
 * 주의: 경로의 teamId 는 조직화 목적이며 보안 경계가 아니다. 스토리지 정책은 bucket_id 만 검사한다.
 */
export function minutesStoragePath(projectId: string, teamId: string, fileName: string, nowMs: number): string {
  return `${projectId}/${teamId}/${nowMs}-${sanitizeFileName(fileName)}`
}

/** 생성 권한 — PMO 는 전체, team_editor 는 자기 팀만. RLS insert_minutes 와 동일 규칙. */
export function canCreateMinutes(m: Membership | null, teamId: string): boolean {
  if (!m) return false
  if (m.role === 'pmo_admin') return true
  return m.role === 'team_editor' && m.teamId === teamId
}

/** 삭제 권한 — 작성자 본인 또는 pmo_admin. domain/meetings.ts:canEditMeeting 과 동형. */
export function canDeleteMinutes(row: { createdBy: string | null }, userId: string | null, role: string | null): boolean {
  if (!userId) return false
  if (role === 'pmo_admin') return true
  return row.createdBy !== null && row.createdBy === userId
}

export interface MinutesInputShape {
  teamId: string
  minutesDate: string
  title: string
  contentMd: string | null
}

/** 검증. 통과하면 null, 실패하면 사용자에게 보여줄 한국어 메시지. */
export function validateMinutesInput(input: MinutesInputShape): string | null {
  if (!input.teamId) return '팀을 선택하세요.'
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (!isValidDate(input.minutesDate)) return '날짜 형식이 올바르지 않습니다.'
  if (input.contentMd !== null && input.contentMd.length > MINUTES_MD_MAX) {
    return `회의록 본문이 너무 큽니다(${MINUTES_MD_MAX}자 이하).`
  }
  return null
}

/**
 * 팀 탭 + 검색어 필터. 팀은 teamId(uuid)로 거른다 —
 * teams.code 에 비-ASCII '가공' 이 있어 쿼리스트링/URL 에 code 를 쓰면 인코딩 문제가 생긴다.
 */
export function filterMinutes(list: MeetingMinutes[], f: { teamId: string | null; q: string }): MeetingMinutes[] {
  const q = f.q.trim().toLowerCase()
  return list.filter(r => {
    if (f.teamId && r.teamId !== f.teamId) return false
    if (!q) return true
    return r.title.toLowerCase().includes(q) || (r.createdByName ?? '').toLowerCase().includes(q)
  })
}

/** hero KPI 3개. todayIso 는 'YYYY-MM-DD'(KST). */
export function summarizeMinutes(
  list: MeetingMinutes[],
  todayIso: string,
): { total: number; thisMonth: number; viewable: number } {
  const month = todayIso.slice(0, 7) // 'YYYY-MM'
  let thisMonth = 0, viewable = 0
  for (const r of list) {
    if (r.minutesDate.startsWith(month)) thisMonth++
    if (r.hasMd) viewable++
  }
  return { total: list.length, thisMonth, viewable }
}
