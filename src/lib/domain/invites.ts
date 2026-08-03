// 프로젝트 초대 순수 함수 — 서버 액션(projectInvites·inviteRedeem)과 초대 화면이 공유한다.
// 부수효과·now() 참조 없음: 시각은 전부 인자로 주입받는다.
import { isValidPassword } from '@/lib/domain/accounts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 공개 라우트 토큰 형식 검증 — DB 조회 전 비정상 입력 차단. 선례: src/lib/minutes/share.ts isShareToken */
export function isInviteToken(s: string): boolean {
  return UUID_RE.test(s)
}

/** DB check 제약(email = lower(btrim(email)))과 같은 규칙. 소비 RPC 의 이메일 대조도 이 형태를 전제한다. */
export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** 허용 도메인 미설정 시 기본값. 외부 주소로 초대가 나가는 것을 막는 fail-closed 기준선. */
export const DEFAULT_ALLOWED_DOMAINS = ['dongkuk.com'] as const

/** 허용 도메인 목록 파싱(쉼표·공백 구분). 빈 입력이면 기본값 — 미설정을 '제한 없음'으로 읽지 않는다. */
export function parseAllowedDomains(raw: string | undefined): string[] {
  const out: string[] = []
  for (const part of (raw ?? '').split(/[\s,]+/)) {
    // '@dongkuk.com' 처럼 적어도 받아들인다(설정 실수가 잦은 형태).
    const d = part.trim().toLowerCase().replace(/^@/, '')
    if (d && !out.includes(d)) out.push(d)
  }
  return out.length > 0 ? out : [...DEFAULT_ALLOWED_DOMAINS]
}

/** normalizeInviteEmail 을 거친 주소가 허용 도메인인가.
 *  '@' 뒤 전체가 목록의 한 항목과 정확히 같아야 한다 — 'a.dongkuk.com' 같은 서브도메인은 불허(사칭 차단). */
export function isAllowedInviteDomain(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return false
  const host = email.slice(at + 1).toLowerCase()
  return domains.some((d) => d.trim().toLowerCase().replace(/^@/, '') === host)
}

export const DEFAULT_INVITE_DAYS = 7
export const MAX_INVITE_DAYS = 30

/** 1~30 정수만 통과. 그 외는 null.
 *  폼이 문자열로 보내므로 '7' 같은 십진 정수 문자열도 받는다('7.5'·'-1'·''·공백은 거부). */
export function normalizeInviteDays(v: unknown): number | null {
  const n = typeof v === 'number' ? v
    : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim())
      : NaN
  if (!Number.isInteger(n)) return null
  if (n < 1 || n > MAX_INVITE_DAYS) return null
  return n
}

export interface InviteStateRow {
  expiresAt: string
  revokedAt: string | null
  redeemedAt: string | null
}
export type InviteStatus = 'active' | 'redeemed' | 'revoked' | 'expired'

/** 우선순위: revoked > redeemed > expired > active.
 *  expiresAt 파싱 실패는 'expired' — 판단 근거가 깨졌을 때 링크를 살려두지 않는다(fail-closed).
 *  만료 경계는 소비 RPC(expires_at > now())와 같게 잡는다: expiresAt === now 는 이미 만료. */
export function inviteStatus(row: InviteStateRow, now: Date): InviteStatus {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  const exp = new Date(row.expiresAt).getTime()
  if (Number.isNaN(exp)) return 'expired'
  return exp > now.getTime() ? 'active' : 'expired'
}

export function inviteStatusLabel(s: InviteStatus): string {
  switch (s) {
    case 'active': return '유효'
    case 'redeemed': return '합류 완료'
    case 'revoked': return '취소됨'
    case 'expired': return '만료됨'
  }
}

/** 메일·화면 표시용 마스킹: 'nam.yu@dongkuk.com' → 'na****@dongkuk.com'.
 *  로컬파트가 2자 이하면 첫 1자만 남긴다. 별표는 최소 1개 — 1자 주소가 그대로 드러나지 않게. */
export function maskEmail(email: string): string {
  const e = normalizeInviteEmail(email)
  const at = e.lastIndexOf('@')
  // 형식이 깨졌으면 무엇도 흘리지 않는다.
  if (at < 1 || at === e.length - 1) return '***'
  const local = e.slice(0, at)
  const keep = local.length > 2 ? 2 : 1
  return local.slice(0, keep) + '*'.repeat(Math.max(local.length - keep, 1)) + e.slice(at)
}

export interface SignupInput { name: string; password: string; passwordConfirmation: string }

/** 가입 폼 검증. 이메일은 초대 행이 정하므로 검증 대상이 아니다(폼에 입력란도 없다).
 *  인증 게이트가 없는 공개 액션(redeemInviteWithSignup)의 첫 관문이라, 타입을 신뢰하지 않고
 *  형상부터 확인한다 — 조작된 요청이 {} 나 { name: 1 } 을 보내도 TypeError 대신 거부로 끝난다. */
export function validateSignupInput(i: SignupInput): { ok: true } | { ok: false; error: string } {
  const o = i as unknown as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object'
    || typeof o.name !== 'string'
    || typeof o.password !== 'string'
    || typeof o.passwordConfirmation !== 'string') {
    return { ok: false, error: '입력값을 확인해 주세요.' }
  }
  if (!i.name.trim()) return { ok: false, error: '이름을 입력해 주세요.' }
  if (!isValidPassword(i.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (i.password !== i.passwordConfirmation) return { ok: false, error: '비밀번호가 일치하지 않습니다.' }
  return { ok: true }
}
