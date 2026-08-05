import { describe, expect, it } from 'vitest'
import {
  ISSUE_ATTACHMENT_MAX_BYTES,
  ISSUE_ATTACHMENT_MAX_COUNT,
  isIssueAttachmentPathValid,
  isIssueAttachmentSizeAllowed,
  makeIssueAttachmentPath,
  remainingIssueAttachmentSlots,
} from '@/lib/domain/issueAttachments'

const ISSUE = '11111111-2222-3333-4444-555555555555'

describe('ISSUE_ATTACHMENT 상한', () => {
  it('파일당 상한은 Supabase 전역 상한과 같은 52,428,800 바이트다', () => {
    // 이보다 크게 잡으면 버킷 설정과 무관하게 전역 상한에서 잘린다.
    expect(ISSUE_ATTACHMENT_MAX_BYTES).toBe(52_428_800)
  })

  it('이슈당 첨부 개수 상한은 10개다', () => {
    expect(ISSUE_ATTACHMENT_MAX_COUNT).toBe(10)
  })
})

describe('makeIssueAttachmentPath', () => {
  it('이슈 id 를 첫 세그먼트로 두고 시각과 안전한 이름을 잇는다', () => {
    expect(makeIssueAttachmentPath(ISSUE, 'report.pdf', 1_700_000_000_000))
      .toBe(`${ISSUE}/1700000000000-report.pdf`)
  })

  it('한글·공백 파일명을 ASCII 객체 키로 바꾼다', () => {
    // Storage 객체 키에는 원본 이름을 쓰지 않는다. 원본은 file_name 컬럼이 보관한다.
    const path = makeIssueAttachmentPath(ISSUE, '회의 자료 최종.xlsx', 1_700_000_000_000)
    expect(path.startsWith(`${ISSUE}/1700000000000-`)).toBe(true)
    expect(/^[\x20-\x7e]+$/.test(path)).toBe(true)
  })

  it('같은 파일명이라도 시각이 다르면 다른 경로가 된다', () => {
    const a = makeIssueAttachmentPath(ISSUE, 'a.png', 1_700_000_000_000)
    const b = makeIssueAttachmentPath(ISSUE, 'a.png', 1_700_000_000_001)
    expect(a).not.toBe(b)
  })

  it('경로 구분자가 든 파일명이 상위 디렉터리로 새 나가지 않는다', () => {
    const path = makeIssueAttachmentPath(ISSUE, '../../etc/passwd', 1_700_000_000_000)
    expect(path.split('/')).toHaveLength(2)
    expect(isIssueAttachmentPathValid(ISSUE, path)).toBe(true)
  })

  it('만들어 낸 경로는 언제나 자기 이슈의 유효 경로다', () => {
    for (const name of ['a.txt', '표.hwp', '.hidden', '...', 'x'.repeat(300)]) {
      expect(isIssueAttachmentPathValid(ISSUE, makeIssueAttachmentPath(ISSUE, name, 1))).toBe(true)
    }
  })
})

describe('isIssueAttachmentPathValid', () => {
  it('자기 이슈 접두로 시작하는 경로만 받는다', () => {
    expect(isIssueAttachmentPathValid(ISSUE, `${ISSUE}/1-a.pdf`)).toBe(true)
  })

  it('다른 이슈의 객체를 자기 메타에 꽂는 경로를 거부한다', () => {
    const other = '99999999-8888-7777-6666-555555555555'
    expect(isIssueAttachmentPathValid(ISSUE, `${other}/1-a.pdf`)).toBe(false)
  })

  it('접두가 부분만 겹치는 경로를 거부한다', () => {
    // 'abc' 가 'abcd/...' 를 통과시키면 안 된다 — 구분자까지 포함해 비교한다.
    expect(isIssueAttachmentPathValid('abc', 'abcd/1-a.pdf')).toBe(false)
  })

  it('상위 디렉터리 탈출을 거부한다', () => {
    expect(isIssueAttachmentPathValid(ISSUE, `${ISSUE}/../other/1-a.pdf`)).toBe(false)
  })

  it('접두만 있고 파일이 없는 경로를 거부한다', () => {
    expect(isIssueAttachmentPathValid(ISSUE, `${ISSUE}/`)).toBe(false)
  })

  it('빈 이슈 id 로는 어떤 경로도 통과하지 않는다', () => {
    expect(isIssueAttachmentPathValid('', '/1-a.pdf')).toBe(false)
  })
})

describe('isIssueAttachmentSizeAllowed', () => {
  it('상한과 정확히 같은 크기는 받는다', () => {
    expect(isIssueAttachmentSizeAllowed(ISSUE_ATTACHMENT_MAX_BYTES)).toBe(true)
  })

  it('상한을 1바이트라도 넘으면 거부한다', () => {
    expect(isIssueAttachmentSizeAllowed(ISSUE_ATTACHMENT_MAX_BYTES + 1)).toBe(false)
  })

  it('빈 파일은 받는다', () => {
    expect(isIssueAttachmentSizeAllowed(0)).toBe(true)
  })

  it('음수·NaN 같은 값은 거부한다', () => {
    expect(isIssueAttachmentSizeAllowed(-1)).toBe(false)
    expect(isIssueAttachmentSizeAllowed(Number.NaN)).toBe(false)
    expect(isIssueAttachmentSizeAllowed(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('remainingIssueAttachmentSlots', () => {
  it('첨부가 없으면 상한만큼 남는다', () => {
    expect(remainingIssueAttachmentSlots(0)).toBe(ISSUE_ATTACHMENT_MAX_COUNT)
  })

  it('상한을 채우면 0이다', () => {
    expect(remainingIssueAttachmentSlots(ISSUE_ATTACHMENT_MAX_COUNT)).toBe(0)
  })

  it('어떤 이유로 상한을 넘겨 저장돼 있어도 음수를 돌려주지 않는다', () => {
    expect(remainingIssueAttachmentSlots(ISSUE_ATTACHMENT_MAX_COUNT + 5)).toBe(0)
  })

  it('조회가 실패해 개수를 모르면 0으로 막는다', () => {
    // 보안·상한 판정은 fail-closed — 모르면 통과시키지 않는다.
    expect(remainingIssueAttachmentSlots(Number.NaN)).toBe(0)
  })
})
