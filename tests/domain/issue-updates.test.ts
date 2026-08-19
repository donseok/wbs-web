import { describe, it, expect } from 'vitest'
import {
  ISSUE_UPDATE_BODY_MAX,
  ISSUE_UPDATE_CATEGORIES,
  canArchiveUpdate,
  canPurgeUpdate,
  encodeStatusChange,
  isIssueUpdateCategory,
  parseMentions,
  parseStatusChange,
} from '@/lib/domain/issueUpdates'

describe('카테고리', () => {
  it('네 가지뿐이다 — 늘어나면 0087 CHECK 제약도 함께 바꿔야 한다', () => {
    expect([...ISSUE_UPDATE_CATEGORIES]).toEqual(['action', 'discuss', 'followup', 'etc'])
  })
  it('알 수 없는 값을 거른다', () => {
    expect(isIssueUpdateCategory('action')).toBe(true)
    expect(isIssueUpdateCategory('resolution')).toBe(false)
    expect(isIssueUpdateCategory(null)).toBe(false)
  })
  it('본문 상한은 한 건당 4000자다', () => {
    expect(ISSUE_UPDATE_BODY_MAX).toBe(4000)
  })
})

describe('canArchiveUpdate — 취소선은 작성자 본인 또는 프로젝트 관리자', () => {
  it('작성자 본인은 그을 수 있다', () => {
    expect(canArchiveUpdate({ authorUserId: 'me' }, 'me', false)).toBe(true)
  })
  it('남의 이력은 못 긋는다 — 이슈 작성자 여부와 무관하다', () => {
    expect(canArchiveUpdate({ authorUserId: 'other' }, 'me', false)).toBe(false)
  })
  it('프로젝트 관리자는 남의 것도 긋는다', () => {
    expect(canArchiveUpdate({ authorUserId: 'other' }, 'me', true)).toBe(true)
  })
  it('비로그인·계정 삭제된 작성자는 fail-closed', () => {
    expect(canArchiveUpdate({ authorUserId: 'other' }, null, false)).toBe(false)
    // 계정이 지워지면 author_user_id 가 null 이 된다. null === null 로 통과시키면
    // 아무나 남의 이력을 긋게 된다.
    expect(canArchiveUpdate({ authorUserId: null }, null, false)).toBe(false)
  })
})

describe('canPurgeUpdate — 완전 삭제는 관리자만', () => {
  it('관리자만 참', () => {
    expect(canPurgeUpdate(true)).toBe(true)
    expect(canPurgeUpdate(false)).toBe(false)
  })
})

describe('상태 변경 인코딩 — 본문에 한국어를 박지 않는다(i18n)', () => {
  it('왕복한다', () => {
    expect(encodeStatusChange('open', 'resolved')).toBe('open>resolved')
    expect(parseStatusChange('open>resolved')).toEqual({ from: 'open', to: 'resolved' })
  })
  it('형식이 아니거나 모르는 상태면 null — 사람이 쓴 글을 상태 줄로 오독하지 않는다', () => {
    expect(parseStatusChange('오늘 협의했습니다')).toBeNull()
    expect(parseStatusChange('open>unknown')).toBeNull()
    expect(parseStatusChange('open>resolved>closed')).toBeNull()
  })
})

describe('parseMentions — 썼다 지운 멘션은 알림을 보내지 않는다', () => {
  const picked = [{ id: 'm1', name: '김준기' }, { id: 'm2', name: '남순혁' }]

  it('본문에 남아 있는 것만 반환한다', () => {
    expect(parseMentions('@김준기 확인 부탁드립니다', picked)).toEqual(['m1'])
  })
  it('본문에서 지운 멘션은 빠진다', () => {
    expect(parseMentions('확인 부탁드립니다', picked)).toEqual([])
  })
  it('선택하지 않은 이름을 손으로 타이핑해도 알림 대상이 되지 않는다', () => {
    expect(parseMentions('@문부성 님도 봐주세요', picked)).toEqual([])
  })
  it('이름이 다른 이름의 접두사여도 오탐하지 않는다', () => {
    const p = [{ id: 'm1', name: '김준' }, { id: 'm2', name: '김준기' }]
    expect(parseMentions('@김준기 님', p)).toEqual(['m2'])
  })
  it('동명이인은 본문의 등장 횟수만큼만 매칭한다', () => {
    const p = [{ id: 'm1', name: '김철수' }, { id: 'm2', name: '김철수' }]
    expect(parseMentions('@김철수 확인', p)).toEqual(['m1'])
    expect(parseMentions('@김철수 와 @김철수', p)).toEqual(['m1', 'm2'])
  })
  it('중복 id 는 한 번만', () => {
    const p = [{ id: 'm1', name: '김준기' }, { id: 'm1', name: '김준기' }]
    expect(parseMentions('@김준기 @김준기', p)).toEqual(['m1'])
  })
})
