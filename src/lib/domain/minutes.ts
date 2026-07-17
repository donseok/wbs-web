import type { Minute, MinutesTreeBody, MinutesTreeGroup, TeamCode } from './types'

export const MINUTE_TITLE_MAX = 200
export const MINUTE_BODY_MAX = 100_000          // body_md 실효 한도(자)
export const MINUTE_BODY_FILE_MAX = 1_048_576   // 원시 .md 파일 안전망(1MB)
export const MINUTE_ATTACHMENT_MAX = 20_971_520 // 첨부 개당 20MB(버킷 file_size_limit와 일치)
export const MINUTE_ATTACHMENTS_MAX_COUNT = 10

export const TEAM_CODES: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface MinuteInput {
  minuteDate: string     // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string
  meetingId: string | null
}

/** 회의록 입력 검증 — 에러 메시지 또는 null. create/updateMeta/replaceBody 가 공유. */
export function validateMinuteInput(input: MinuteInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > MINUTE_TITLE_MAX) return `제목은 ${MINUTE_TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.minuteDate)) return '날짜 형식이 올바르지 않습니다.'
  if (!TEAM_CODES.includes(input.teamCode)) return '잘못된 담당입니다.'
  if (input.bodyMd.length > MINUTE_BODY_MAX) return '본문은 100,000자 이하여야 합니다.'
  return null
}

/** 원본 표시명과 별개로 Supabase Storage 객체 키에 사용할 ASCII 파일명. */
export function sanitizeFileName(name: string): string {
  const safe = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')

  return safe && !/^[._-]+$/.test(safe) ? safe : 'file'
}

/** Storage 경로가 해당 회의록 전용 접두({minuteId}/)인지 — 타 객체를 가리키는 메타 기록 차단. */
export function isMinuteFilePathValid(minuteId: string, path: string): boolean {
  return path.startsWith(`${minuteId}/`) && !path.includes('..')
}

/** PostgREST or() 필터에 안전하게 삽입할 ILIKE 패턴(큰따옴표 인용 포함).
 *  1단계: LIKE 이스케이프(\, %, _ 를 \ 접두) → 2단계: PostgREST 인용 이스케이프(\ 와 " ). */
export function ilikeOrPattern(needle: string): string {
  const like = needle.replace(/[\\%_]/g, m => `\\${m}`)
  const quoted = like.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"%${quoted}%"`
}

/* ── 트리 뷰: 회의체 추출 (스펙 2026-07-17-minutes-tree-view-design.md) ── */

export const MINUTES_TREE_LIMIT = 1000 // PostgREST max_rows 하드 캡(supabase/config.toml)과 일치 — 초과 값은 성립 불가

// 노이즈 토큰(전체 일치): 날짜형 5패턴(6/8자리·연월일·2자리 연도·월일, 꼬리 요일 괄호 허용) + 회차형 + 요일 괄호 단독
const WEEKDAY_TAIL = '(?:\\((?:월|화|수|목|금|토|일)\\))?'
const NOISE_PATTERNS = [
  new RegExp(`^\\d{6}${WEEKDAY_TAIL}$`),                                    // 260716
  new RegExp(`^\\d{8}${WEEKDAY_TAIL}$`),                                    // 20260716
  new RegExp(`^\\d{4}[.\\-/]\\d{1,2}(?:[.\\-/]\\d{1,2})?${WEEKDAY_TAIL}$`), // 2026-07-16, 2026.07
  new RegExp(`^\\d{2}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),      // 26.07.16
  new RegExp(`^\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),                   // 7.16, 07-16
  /^\(?제?\d{1,4}차\)?$/,                                                    // 12차, 제3차, (5차)
  /^\((?:월|화|수|목|금|토|일)\)$/,                                          // (수)
]

function isNoiseToken(token: string): boolean {
  return NOISE_PATTERNS.some(re => re.test(token))
}

/** 제목에서 회의체 이름 추출 — `_`·공백 토큰화 후 노이즈(날짜·회차·요일) 제거, 공백 1칸 결합.
 *  전부 제거되어 비면 원제목(trim) 반환. 그룹 키이자 표시명. */
export function meetingBodyOf(title: string): string {
  const trimmed = title.trim()
  const kept = trimmed.split(/[_\s]+/).filter(tok => tok !== '' && !isNoiseToken(tok))
  return kept.length > 0 ? kept.join(' ') : trimmed
}

/** 목록 → 트리 조립. 입력이 minute_date desc, created_at desc 정렬임을 전제하며 자체 재정렬하지 않는다
 *  (리프 순서 = 입력 순서). 팀은 TEAM_CODES 순 — 미지 코드는 조용히 버리지 않고 뒤에 등장 순으로 붙인다.
 *  회의체는 latestDate desc(동률은 첫 등장 순 — 안정 정렬). 0건 팀은 그룹을 만들지 않는다. */
export function buildMinutesTree(minutes: Minute[]): MinutesTreeGroup[] {
  const byTeam = new Map<string, Map<string, MinutesTreeBody>>()
  const teamAppearance: string[] = []
  for (const mi of minutes) {
    let bodies = byTeam.get(mi.teamCode)
    if (!bodies) {
      bodies = new Map()
      byTeam.set(mi.teamCode, bodies)
      teamAppearance.push(mi.teamCode)
    }
    const name = meetingBodyOf(mi.title)
    let body = bodies.get(name)
    if (!body) {
      body = { name, count: 0, latestDate: mi.minuteDate, leaves: [] }
      bodies.set(name, body)
    }
    body.count += 1
    body.leaves.push({
      id: mi.id, minuteDate: mi.minuteDate, title: mi.title,
      fileCount: mi.fileCount ?? 0, createdByName: mi.createdByName,
    })
  }
  const known = TEAM_CODES.filter(tk => byTeam.has(tk)) as string[]
  const unknown = teamAppearance.filter(tk => !(TEAM_CODES as string[]).includes(tk))
  return [...known, ...unknown].map(tk => {
    const bodies = [...byTeam.get(tk)!.values()]
    // Array.sort는 안정 정렬 — 동률(latestDate 같음)은 Map 삽입 순서(첫 등장 순) 유지
    bodies.sort((a, b) => (a.latestDate < b.latestDate ? 1 : a.latestDate > b.latestDate ? -1 : 0))
    return {
      teamCode: tk as TeamCode,
      count: bodies.reduce((sum, b) => sum + b.count, 0),
      bodies,
    }
  })
}
