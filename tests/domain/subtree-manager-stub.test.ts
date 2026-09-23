// F15 — stub 하위의 서브트리 관리자 판정은 후행(부모)을 조상으로 치지 않는다. 후행 담당자의 자기 승인을 막는다.
import { describe, expect, it } from 'vitest'
import { isSubtreeManagerOf, type AncestorLike } from '@/lib/domain/seatmap'

const items: AncestorLike[] = [
  { id: 'wp', parent_id: null, assignee_member_id: 'lead' },
  { id: 'succ', parent_id: 'wp', assignee_member_id: 'dev' },
  { id: 'sub', parent_id: 'succ', assignee_member_id: 'dev', stub_for: 'm/TSK-01' },
  { id: 'child', parent_id: 'succ', assignee_member_id: null },
]
const byId = new Map(items.map(i => [i.id, i]))

describe('isSubtreeManagerOf — stub 하위', () => {
  it('후행 담당자는 stub 하위의 서브트리 관리자가 아니다', () => {
    expect(isSubtreeManagerOf('sub', byId, new Set(['dev']))).toBe(false)
  })
  it('후행보다 위 조상의 담당자는 여전히 관리자다', () => {
    expect(isSubtreeManagerOf('sub', byId, new Set(['lead']))).toBe(true)
  })
  it('일반 자식은 종전대로 부모 담당자가 관리자다', () => {
    expect(isSubtreeManagerOf('child', byId, new Set(['dev']))).toBe(true)
  })
})
