import { describe, expect, it } from 'vitest'
import {
  PRESENCE_COLORS, presenceColor, buildPresenceMap, onlinePeers, CELL_PEERS_MAX,
  type PresencePeer,
} from '@/lib/domain/sheetPresence'

function peer(over: Partial<PresencePeer>): PresencePeer {
  return {
    connKey: 'u1:aaaa', userId: 'u1', name: '철수',
    rowId: 'r1', col: 'this_content', editing: false, ...over,
  }
}

describe('presenceColor', () => {
  it('결정적 — 같은 userId는 항상 같은 색', () => {
    expect(presenceColor('user-abc')).toBe(presenceColor('user-abc'))
  })
  it('팔레트 안의 색만 반환한다', () => {
    for (const id of ['a', 'user-1', 'f0e9d8c7-1234', '한글아이디', '']) {
      expect(PRESENCE_COLORS).toContain(presenceColor(id))
    }
  })
  it('서로 다른 userId가 대체로 다른 색을 받는다(해시 분산 스모크)', () => {
    const colors = new Set(['u-1', 'u-2', 'u-3', 'u-4'].map(presenceColor))
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('buildPresenceMap', () => {
  it('자기 자신(userId 일치)은 다른 탭이어도 제외한다', () => {
    const map = buildPresenceMap([
      peer({ userId: 'me', connKey: 'me:tab1' }),
      peer({ userId: 'me', connKey: 'me:tab2', rowId: 'r2' }),
      peer({ userId: 'u2', connKey: 'u2:a', name: '영희' }),
    ], 'me')
    expect(map.size).toBe(1)
    expect(map.get('r1:this_content')?.[0].name).toBe('영희')
  })
  it('셀 좌표 없는 피어(rowId/col 빈값)는 매핑하지 않는다', () => {
    const map = buildPresenceMap([peer({ rowId: '' }), peer({ col: '' })], 'me')
    expect(map.size).toBe(0)
  })
  it('같은 사용자의 다중 탭이 같은 셀이면 1개만 남긴다', () => {
    const map = buildPresenceMap([
      peer({ userId: 'u2', connKey: 'u2:a' }),
      peer({ userId: 'u2', connKey: 'u2:b' }),
    ], 'me')
    expect(map.get('r1:this_content')).toHaveLength(1)
  })
  it('같은 셀의 서로 다른 사용자는 모두 모은다(칩 상한은 렌더 몫)', () => {
    const many = ['u2', 'u3', 'u4', 'u5'].map(id => peer({ userId: id, connKey: `${id}:a`, name: id }))
    const map = buildPresenceMap(many, 'me')
    expect(map.get('r1:this_content')).toHaveLength(4)
    expect(CELL_PEERS_MAX).toBeLessThan(4) // 렌더가 +N으로 접을 수 있는 전제 확인
  })
  it('다른 셀은 다른 키로 분리된다', () => {
    const map = buildPresenceMap([
      peer({ userId: 'u2', connKey: 'u2:a' }),
      peer({ userId: 'u3', connKey: 'u3:a', rowId: 'r2', col: 'next_issue' }),
    ], 'me')
    expect([...map.keys()].sort()).toEqual(['r1:this_content', 'r2:next_issue'])
  })
})

describe('onlinePeers', () => {
  it('자기 제외 + userId dedupe + 이름 가나다순', () => {
    const list = onlinePeers([
      peer({ userId: 'me', name: '나' }),
      peer({ userId: 'u2', name: '영희', connKey: 'u2:a' }),
      peer({ userId: 'u2', name: '영희', connKey: 'u2:b', rowId: 'r9' }),
      peer({ userId: 'u3', name: '강준', connKey: 'u3:a' }),
    ], 'me')
    expect(list).toEqual([
      { userId: 'u3', name: '강준' },
      { userId: 'u2', name: '영희' },
    ])
  })
  it('셀 좌표가 없어도(문서만 열람) 온라인 목록에는 포함된다', () => {
    const list = onlinePeers([peer({ userId: 'u2', name: '영희', rowId: '', col: '' })], 'me')
    expect(list).toHaveLength(1)
  })
})
