import { describe, it, expect } from 'vitest'
import {
  MINUTE_ATTACHMENTS_MAX_COUNT,
  remainingMinuteAttachmentSlots,
} from '@/lib/domain/minutes'

/**
 * 회의록 첨부 개수 상한의 단일 정본.
 *
 * 등록 모달만 상한을 보던 시절에는 UI 가 유일한 관문이었다. 상세 화면에서 나중에 첨부를
 * 추가할 수 있게 되면서 서버 액션도 같은 판정을 해야 하므로, 두 곳이 같은 순수 함수를 쓴다.
 * 이슈 첨부(remainingIssueAttachmentSlots)와 같은 계약이다.
 */
describe('remainingMinuteAttachmentSlots', () => {
  it('첨부가 없으면 상한만큼 남는다', () => {
    expect(remainingMinuteAttachmentSlots(0)).toBe(MINUTE_ATTACHMENTS_MAX_COUNT)
  })

  it('상한 직전에는 1칸만 남는다', () => {
    expect(remainingMinuteAttachmentSlots(MINUTE_ATTACHMENTS_MAX_COUNT - 1)).toBe(1)
  })

  it('상한에 도달하면 0이다', () => {
    expect(remainingMinuteAttachmentSlots(MINUTE_ATTACHMENTS_MAX_COUNT)).toBe(0)
  })

  it('이미 상한을 넘겼어도 음수를 돌려주지 않는다', () => {
    expect(remainingMinuteAttachmentSlots(MINUTE_ATTACHMENTS_MAX_COUNT + 5)).toBe(0)
  })

  // 개수 조회가 실패한 자리에 NaN 이 흘러들어올 수 있다. 그때 상한을 열어주면
  // "모르면 통과"가 되어 가드가 fail-open 이 된다 — 0 을 돌려 막는다.
  it('개수를 알 수 없으면(NaN·Infinity) 한 칸도 열어주지 않는다', () => {
    expect(remainingMinuteAttachmentSlots(Number.NaN)).toBe(0)
    expect(remainingMinuteAttachmentSlots(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
