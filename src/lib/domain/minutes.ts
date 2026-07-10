import type { TeamCode } from './types'

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
