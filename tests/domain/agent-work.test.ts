import { describe, expect, it } from 'vitest'
import {
  AGENT_CLAIM_STALE_HOURS, AGENT_NAME_RE, canTransition, isClaimStale, validateReport, isUuidLike, orderPriorityFromLabel,
  validateEvidence,
} from '@/lib/domain/agentWork'

describe('agentWork 상태 머신', () => {
  it('허용 전이 전수', () => {
    expect(canTransition('ready', 'claimed')).toBe(true)
    expect(canTransition('ready', 'cancelled')).toBe(true)
    expect(canTransition('claimed', 'ready')).toBe(true)      // release/회수
    expect(canTransition('claimed', 'reported')).toBe(true)
    expect(canTransition('claimed', 'cancelled')).toBe(true)
    expect(canTransition('reported', 'claimed')).toBe(true)   // 반려 복귀
    expect(canTransition('reported', 'approved')).toBe(true)
    expect(canTransition('reported', 'cancelled')).toBe(true)
    // 사람이 승인을 무르는 두 경로(2026-08-27) — 검토 대기열 복귀 / 에이전트 재작업
    expect(canTransition('approved', 'reported')).toBe(true)
    expect(canTransition('approved', 'claimed')).toBe(true)
  })
  it('금지 전이 — 종료 상태에서 못 나오고, 건너뛰기 불가', () => {
    expect(canTransition('approved', 'ready')).toBe(false)
    expect(canTransition('cancelled', 'claimed')).toBe(false)
    expect(canTransition('ready', 'reported')).toBe(false)    // claim 없이 보고 불가
    expect(canTransition('ready', 'approved')).toBe(false)
    expect(canTransition('claimed', 'approved')).toBe(false)  // 보고 없이 승인 불가
  })
  it('progress 는 0~99 만 — 100 은 완료 요청 경로로 강제', () => {
    expect(validateReport('progress', 0)).toBeNull()
    expect(validateReport('progress', 99)).toBeNull()
    expect(validateReport('progress', 100)).toMatch(/completion/)
    expect(validateReport('progress', -1)).not.toBeNull()
    expect(validateReport('progress', 50.5)).not.toBeNull()   // 정수만
  })
  it('completion 은 100 고정', () => {
    expect(validateReport('completion', 100)).toBeNull()
    expect(validateReport('completion', 99)).not.toBeNull()
  })
  it('좀비 점유 판정 — 24h 경계', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const fresh = new Date(now.getTime() - (AGENT_CLAIM_STALE_HOURS - 1) * 3600_000).toISOString()
    const stale = new Date(now.getTime() - (AGENT_CLAIM_STALE_HOURS + 1) * 3600_000).toISOString()
    expect(isClaimStale(fresh, now)).toBe(false)
    expect(isClaimStale(stale, now)).toBe(true)
    expect(isClaimStale(null, now)).toBe(false)
  })
  it('에이전트 이름 형식', () => {
    expect(AGENT_NAME_RE.test('claude-cli.jerry_1')).toBe(true)
    expect(AGENT_NAME_RE.test('')).toBe(false)
    expect(AGENT_NAME_RE.test('이름에 공백')).toBe(false)
    expect(AGENT_NAME_RE.test('x'.repeat(65))).toBe(false)
  })
  it('UUID 형식 검증', () => {
    expect(isUuidLike('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuidLike('invalid-id')).toBe(false)
    expect(isUuidLike('11111111111141118111111111111111')).toBe(false)
  })
  it('priority 라벨 → 정수 매핑', () => {
    expect(orderPriorityFromLabel('critical')).toBe(100)
    expect(orderPriorityFromLabel('high')).toBe(50)
    expect(orderPriorityFromLabel('medium')).toBe(10)
    expect(orderPriorityFromLabel('low')).toBe(0)
    expect(orderPriorityFromLabel(null)).toBe(0)
    expect(orderPriorityFromLabel('urgent')).toBe(0) // 미지 라벨
  })
})

describe('validateEvidence', () => {
  it('정상 evidence 통과', () => {
    const r = validateEvidence({ branch: 'agent/abc-fix', head_sha: 'a'.repeat(40), repo_url: 'https://github.com/x/y', checks: [{ name: 'ci', status: 'pass' }] })
    expect(r.ok).toBe(true)
  })
  it('SHA 형식 위반·비 http URL·미지 필드 거부', () => {
    expect(validateEvidence({ head_sha: 'zzz' }).ok).toBe(false)
    expect(validateEvidence({ repo_url: 'ftp://x' }).ok).toBe(false)
    expect(validateEvidence({ unknown_field: 1 }).ok).toBe(false)
  })
  it('undefined 는 빈 evidence 로 통과(선택 필드)', () => {
    expect(validateEvidence(undefined)).toEqual({ ok: true, evidence: {} })
  })
})
