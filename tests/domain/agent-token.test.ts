import { describe, expect, it } from 'vitest'
import { isPatFormat, parsePatPrefix, tokenUsable } from '@/lib/domain/agentToken'
import { generateAgentToken, hashMatches, hashToken } from '@/lib/agent/token'

describe('agentToken 도메인', () => {
  it('PAT 형식 판정·prefix 추출', () => {
    const { token, prefix } = generateAgentToken()
    expect(isPatFormat(token)).toBe(true)
    expect(parsePatPrefix(token)).toBe(prefix)
    expect(prefix).toHaveLength(12)
    expect(parsePatPrefix('dflow_pat_short')).toBeNull()
    expect(parsePatPrefix('Bearer abc')).toBeNull()
    expect(isPatFormat('dflow_pat_ABCDEFGHIJKL_')).toBe(false) // secret 없음
  })
  it('발급마다 토큰·prefix가 다르고 hash는 sha256 hex 64자', () => {
    const a = generateAgentToken()
    const b = generateAgentToken()
    expect(a.token).not.toBe(b.token)
    expect(a.prefix).not.toBe(b.prefix)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).toBe(hashToken(a.token))
  })
  it('hashMatches — 일치 true, 불일치 false', () => {
    const { token, hash } = generateAgentToken()
    expect(hashMatches(token, hash)).toBe(true)
    expect(hashMatches(token + 'x', hash)).toBe(false)
  })
  it('tokenUsable — enabled → revoked → expired 순서 판정', () => {
    const now = new Date('2026-08-10T00:00:00Z')
    const base = { enabled: true, revoked_at: null, expires_at: '2026-12-31T00:00:00Z' }
    expect(tokenUsable(base, now)).toEqual({ ok: true })
    expect(tokenUsable({ ...base, enabled: false }, now)).toEqual({ ok: false, reason: 'disabled' })
    expect(tokenUsable({ ...base, revoked_at: '2026-08-01T00:00:00Z' }, now)).toEqual({ ok: false, reason: 'revoked' })
    expect(tokenUsable({ ...base, expires_at: '2026-08-09T00:00:00Z' }, now)).toEqual({ ok: false, reason: 'expired' })
    // revoked 이면서 expired 면 revoked 가 먼저(검사 순서 §2.1)
    expect(tokenUsable({ ...base, revoked_at: '2026-08-01T00:00:00Z', expires_at: '2026-08-02T00:00:00Z' }, now))
      .toEqual({ ok: false, reason: 'revoked' })
  })
})
