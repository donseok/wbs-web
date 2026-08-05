// 이슈 첨부 도메인 — 순수 함수만(I/O 없음).
// 스펙: docs/superpowers/specs/2026-08-05-issue-attachments-design.md
//
// 상한·경로 규칙의 단일 정본이다. UI(고른 즉시 거르기)와 서버 액션(재검증)이 같은 함수를 쓴다.
// 파일명 sanitize 는 회의록 첨부와 같은 규칙을 쓴다 — 보안에 걸린 로직을 두 벌로 두지 않는다.
import { sanitizeFileName } from './minutes'

/**
 * 파일당 상한. Supabase 프로젝트 전역 업로드 상한과 같은 값이라
 * 이보다 크게 잡아도 버킷 설정과 무관하게 전역 상한에서 잘린다.
 */
export const ISSUE_ATTACHMENT_MAX_BYTES = 52_428_800

/** 이슈당 첨부 개수 상한. DB 제약이 아니라 서버 액션과 UI 가 검사한다. */
export const ISSUE_ATTACHMENT_MAX_COUNT = 10

/** 화면이 쓰는 읽기 모델. `url` 은 조회 시점에 만든 서명 URL 이며 실패하면 null 이다. */
export interface IssueAttachment {
  id: string
  issueId: string
  fileName: string
  filePath: string
  size: number | null
  mime: string | null
  createdAt: string
  url: string | null
}

/**
 * Storage 객체 키. 첫 세그먼트가 이슈 id 라는 규약을 스토리지 RLS 정책이 그대로 쓴다
 * (`split_part(name, '/', 1)::uuid`). 원본 파일명은 file_name 컬럼이 보관하고
 * 다운로드 때 복원하므로, 키에는 ASCII 안전명만 넣는다.
 */
export function makeIssueAttachmentPath(issueId: string, fileName: string, now: number): string {
  return `${issueId}/${now}-${sanitizeFileName(fileName)}`
}

/** 경로가 해당 이슈 전용 접두({issueId}/)인지 — 타 이슈의 객체를 메타에 꽂는 것을 막는다. */
export function isIssueAttachmentPathValid(issueId: string, path: string): boolean {
  if (!issueId) return false
  const prefix = `${issueId}/`
  return path.startsWith(prefix) && path.length > prefix.length && !path.includes('..')
}

/** 파일 하나가 상한 안인지. 크기를 알 수 없으면(NaN·Infinity) 통과시키지 않는다. */
export function isIssueAttachmentSizeAllowed(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= ISSUE_ATTACHMENT_MAX_BYTES
}

/** 더 붙일 수 있는 개수. 개수를 모르면 0 — 상한 판정은 fail-closed 다. */
export function remainingIssueAttachmentSlots(existingCount: number): number {
  if (!Number.isFinite(existingCount)) return 0
  return Math.max(0, ISSUE_ATTACHMENT_MAX_COUNT - existingCount)
}
