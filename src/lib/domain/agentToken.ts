/**
 * PAT 토큰 도메인 — 계약 v2.0 (api-contract.md).
 * 형식: dflow_pat_<prefix 12자 영숫자>_<secret base64url>. prefix 는 비밀이 아니라 조회 키다.
 */
export const PAT_RE = /^dflow_pat_([A-Za-z0-9]{12})_([A-Za-z0-9_-]{20,})$/

export function isPatFormat(token: string): boolean {
  return PAT_RE.test(token)
}

export function parsePatPrefix(token: string): string | null {
  const m = PAT_RE.exec(token)
  return m ? m[1] : null
}

export type TokenRowState = { enabled: boolean; revoked_at: string | null; expires_at: string }

/** 검사 순서는 계약 고정: enabled → revoked → expires. hash 비교는 이 뒤(호출부). */
export function tokenUsable(
  row: TokenRowState, now: Date = new Date(),
): { ok: true } | { ok: false; reason: 'disabled' | 'revoked' | 'expired' } {
  if (!row.enabled) return { ok: false, reason: 'disabled' }
  if (row.revoked_at) return { ok: false, reason: 'revoked' }
  const exp = Date.parse(row.expires_at)
  if (Number.isNaN(exp) || exp <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true }
}
