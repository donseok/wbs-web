import type { MeetingAttendeeInfo } from '@/lib/domain/types'

/** 발송 전 제외 사유. 'rejected' 는 전송 후 SMTP 응답으로만 붙는다(여기서는 나오지 않는다). */
export type SkipReason = 'no_email' | 'invalid_email' | 'rejected'

export interface Recipient { name: string; email: string }
export interface Classified {
  valid: Recipient[]
  skipped: { name: string; reason: Exclude<SkipReason, 'rejected'> }[]
}

// 로컬파트@도메인.TLD — 공백/중복@ 를 배제하고 TLD 2자 이상을 요구한다.
// , ; < > " 도 함께 막는다. 콤마·세미콜론은 메일 헤더에서 주소를 나누는 구분자이고
// <> " 는 주소 형식(Display Name <addr>) 자체의 문법 문자라, 주소 안에 들어 있으면
// SMTP 가 그 주소를 유효한 도메인/로컬파트로 읽지 못해 메일 한 통 전체를 거절한다.
// (\s 가 CR/LF 를 포함하므로 헤더 인젝션은 이미 막힌다.)
// RFC 전체를 구현하지 않는다. 목적은 '이 주소를 SMTP 에 넘겨도 한 통 전체가 거절되지 않는가' 뿐이다.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@.,;<>"]+(\.[^\s@.,;<>"]+)*\.[A-Za-z]{2,}$/

/**
 * 참석자를 발송 가능/제외로 가른다.
 * 이메일은 소문자·trim 으로 정규화하고, 같은 주소가 중복되면 처음 것만 남긴다
 * (같은 사람이 두 멤버 행으로 들어와 메일을 두 번 받는 일을 막는다).
 */
export function classifyRecipients(attendees: MeetingAttendeeInfo[]): Classified {
  const valid: Recipient[] = []
  const skipped: Classified['skipped'] = []
  const seen = new Set<string>()

  for (const a of attendees) {
    const raw = a.email?.trim() ?? ''
    if (!raw) { skipped.push({ name: a.name, reason: 'no_email' }); continue }
    const email = raw.toLowerCase()
    if (!EMAIL_RE.test(email)) { skipped.push({ name: a.name, reason: 'invalid_email' }); continue }
    if (seen.has(email)) continue
    seen.add(email)
    valid.push({ name: a.name, email })
  }
  return { valid, skipped }
}
