import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** PAT 발급·검증 — 평문은 호출부의 발급 응답 1회만 존재한다. DB 에는 hash 만 저장. */
export function generateAgentToken(): { token: string; prefix: string; hash: string } {
  // prefix 12자 영숫자 — base64url 에서 -,_ 를 걸러 12자를 채운다(조회 키, 충돌 시 재생성은 호출부 unique 위반 처리).
  let prefix = ''
  while (prefix.length < 12) {
    prefix += randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '')
  }
  prefix = prefix.slice(0, 12)
  const secret = randomBytes(32).toString('base64url') // 43자
  const token = `dflow_pat_${prefix}_${secret}`
  return { token, prefix, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 저장 hash 와 제공 토큰의 상수시간 비교 — 길이 노출 방지 위해 해시끼리 비교한다. */
export function hashMatches(providedToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(providedToken), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
