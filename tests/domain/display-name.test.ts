import { describe, it, expect } from 'vitest'
import { displayNameFrom } from '@/lib/domain/display-name'

// 계정 생성(accounts.ts:66)은 user_metadata.full_name 에 이름을 쓴다.
// 과거 actions/meetings.ts 는 .name 을 읽어 항상 이메일 폴백을 탔다 — 이 헬퍼로 통일한다.
describe('displayNameFrom', () => {
  it('full_name 이 있으면 그것을 쓴다', () => {
    expect(displayNameFrom({ full_name: '홍춘식' }, 'chunsik.hong@dongkuk.com')).toBe('홍춘식')
  })

  it('full_name 이 없으면 name(OAuth 프로바이더 관례)으로 폴백한다', () => {
    expect(displayNameFrom({ name: 'Jane Kim' }, 'jane@x.com')).toBe('Jane Kim')
  })

  it('full_name 이 공백뿐이면 name 으로 넘어간다', () => {
    expect(displayNameFrom({ full_name: '   ', name: 'Jane' }, 'jane@x.com')).toBe('Jane')
  })

  it('둘 다 없으면 이메일 아이디(@ 앞)를 쓴다 — 전체 이메일 노출 방지', () => {
    expect(displayNameFrom({}, 'dcube@dongkuk.com')).toBe('dcube')
  })

  it('metadata 가 null/undefined 여도 안전하다', () => {
    expect(displayNameFrom(null, 'dcube@dongkuk.com')).toBe('dcube')
    expect(displayNameFrom(undefined, 'dcube@dongkuk.com')).toBe('dcube')
  })

  it('이름도 이메일도 없으면 null', () => {
    expect(displayNameFrom(null, null)).toBeNull()
    expect(displayNameFrom({}, '')).toBeNull()
  })

  it('문자열이 아닌 metadata 값은 무시한다', () => {
    expect(displayNameFrom({ full_name: 42, name: ['a'] } as never, 'x@y.com')).toBe('x')
  })
})
