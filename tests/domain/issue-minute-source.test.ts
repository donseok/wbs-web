import { describe, expect, it } from 'vitest'
import {
  issueDraftFromBlock,
  makeMinuteIssueSourceKey,
  validateIssueDateRange,
} from '@/lib/domain/issueMinuteSource'

const SOURCE = {
  minuteVersionId: 'version-1',
  blockIndex: 4,
  blockHash: 'abcdef0123456789',
  kind: 'risk' as const,
}

describe('makeMinuteIssueSourceKey', () => {
  it('같은 원본 입력에는 항상 같은 키를 만든다', () => {
    expect(makeMinuteIssueSourceKey(SOURCE)).toBe(makeMinuteIssueSourceKey({ ...SOURCE }))
  })

  it('버전·블록·해시·분류가 다르면 서로 다른 키를 만든다', () => {
    const keys = [
      makeMinuteIssueSourceKey(SOURCE),
      makeMinuteIssueSourceKey({ ...SOURCE, minuteVersionId: 'version-2' }),
      makeMinuteIssueSourceKey({ ...SOURCE, blockIndex: 5 }),
      makeMinuteIssueSourceKey({ ...SOURCE, blockHash: '0123456789abcdef' }),
      makeMinuteIssueSourceKey({ ...SOURCE, kind: 'action' }),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('선택 발췌 해시가 있으면 :sel:<hash> 접미사로 블록 전체 키와 구분한다', () => {
    const base = {
      minuteVersionId: 'version-1',
      blockIndex: 3,
      blockHash: 'ABCDEF0123456789',
      kind: 'manual' as const,
    }
    expect(makeMinuteIssueSourceKey({ ...base, selectionHash: 'FEDCBA9876543210' }))
      .toBe('minute:version-1:3:abcdef0123456789:manual:sel:fedcba9876543210')
    // null/미전송은 기존 키와 바이트 단위 동일(하위 호환)
    expect(makeMinuteIssueSourceKey({ ...base, selectionHash: null }))
      .toBe('minute:version-1:3:abcdef0123456789:manual')
    expect(makeMinuteIssueSourceKey(base))
      .toBe('minute:version-1:3:abcdef0123456789:manual')
  })
})

describe('issueDraftFromBlock', () => {
  it('블록 본문을 그대로 보존하고 제목은 200자를 넘지 않는다', () => {
    const text = `장기 미해결 이슈 ${'가'.repeat(240)}\n후속 조치가 필요합니다.`
    const draft = issueDraftFromBlock(text)

    expect(draft.body).toBe(text)
    expect(draft.title.length).toBeGreaterThan(0)
    expect(draft.title.length).toBeLessThanOrEqual(200)
    expect(draft.title).not.toMatch(/…|\.{3,}/)
  })

  it('인사이트 라벨이 있으면 블록 텍스트보다 제목으로 우선 사용한다', () => {
    const text = '원자재 수급 지연 가능성이 논의되었습니다.'
    const insightLabel = '원자재 수급 지연 대응 필요'
    const draft = issueDraftFromBlock(text, insightLabel)

    expect(draft.title).toBe(insightLabel)
    expect(draft.body).toBe(text)
  })

  it('인사이트 라벨을 사용하더라도 제목은 200자를 넘지 않는다', () => {
    const draft = issueDraftFromBlock('원문', '위험'.repeat(120))

    expect(draft.title.length).toBeLessThanOrEqual(200)
    expect(draft.title).not.toMatch(/…|\.{3,}/)
    expect(draft.body).toBe('원문')
  })
})

describe('validateIssueDateRange', () => {
  it.each([
    [null, null],
    ['2026-07-27', null],
    [null, '2026-07-27'],
  ])('시작일 또는 목표일이 없으면 허용한다 (%s, %s)', (startDate, dueDate) => {
    expect(validateIssueDateRange(startDate, dueDate)).toBe(true)
  })

  it('시작일과 목표일이 같거나 시작일이 앞서면 허용한다', () => {
    expect(validateIssueDateRange('2026-07-27', '2026-07-27')).toBe(true)
    expect(validateIssueDateRange('2026-07-27', '2026-08-03')).toBe(true)
  })

  it('시작일이 목표일보다 늦으면 거부한다', () => {
    expect(validateIssueDateRange('2026-08-04', '2026-08-03')).toBe(false)
  })
})
