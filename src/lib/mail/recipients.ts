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

/** 폼의 추가 수신 이메일 상한. 클라이언트 사전 검증과 서버 가드가 같은 값을 본다. */
export const MAX_EXTRA_EMAILS = 20

/** 254자는 RFC 5321 경로 상한 — 넘는 주소는 어차피 수신이 불가능하다. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email)
}

/**
 * 추가 수신 이메일 입력 원문을 주소 배열로. 쉼표·세미콜론·공백·줄바꿈 무엇으로 구분해도
 * 받아들인다 — 유효한 주소에는 이 문자들이 들어갈 수 없어(EMAIL_RE) 잘못 쪼개질 일이 없다.
 * 소문자 정규화와 중복 제거까지만 하고, 유효성 판정은 하지 않는다 —
 * 무엇이 잘못됐는지는 호출자가 isValidEmail 로 가려 사용자에게 보여준다.
 */
export function parseExtraEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(e => e.toLowerCase()).filter(Boolean))]
}

/**
 * 참석자와 추가 수신 이메일을 발송 가능/제외로 가른다.
 * 이메일은 소문자·trim 으로 정규화하고, 같은 주소가 중복되면 처음 것만 남긴다
 * (같은 사람이 두 멤버 행으로 들어와 메일을 두 번 받는 일을 막는다 — 참석자로도 있고
 * 추가 입력으로도 적힌 주소가 두 번 받는 일도 같은 세트가 막는다).
 * 추가 이메일에는 사람 이름이 없다 — 결과 보고의 name 자리에는 주소 자체를 쓴다.
 */
export function classifyRecipients(
  attendees: MeetingAttendeeInfo[],
  extraEmails: string[] = [],
): Classified {
  const valid: Recipient[] = []
  const skipped: Classified['skipped'] = []
  const seen = new Set<string>()

  for (const a of attendees) {
    const raw = a.email?.trim() ?? ''
    if (!raw) { skipped.push({ name: a.name, reason: 'no_email' }); continue }
    const email = raw.toLowerCase()
    if (!isValidEmail(email)) { skipped.push({ name: a.name, reason: 'invalid_email' }); continue }
    if (seen.has(email)) continue
    seen.add(email)
    valid.push({ name: a.name, email })
  }

  for (const raw of extraEmails) {
    const email = raw.trim().toLowerCase()
    if (!email) continue // 빈 토큰은 보고할 이름조차 없다 — 조용히 버린다
    if (!isValidEmail(email)) { skipped.push({ name: email, reason: 'invalid_email' }); continue }
    if (seen.has(email)) continue
    seen.add(email)
    valid.push({ name: email, email })
  }
  return { valid, skipped }
}
