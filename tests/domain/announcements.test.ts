import { describe, it, expect } from 'vitest'
import {
  ANNOUNCEMENT_META, ANNOUNCEMENT_CATEGORIES,
  sortAnnouncements, isUnread, countUnread, summarizeAnnouncements,
} from '@/lib/domain/announcements'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

function ann(id: string, createdAt: string, opts: Partial<Announcement> = {}): Announcement {
  return {
    id,
    projectId: 'p1',
    title: `공지 ${id}`,
    body: '',
    category: 'general',
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    ...opts,
  }
}

describe('sortAnnouncements', () => {
  it('고정 공지가 먼저, 그다음 최신순', () => {
    const items = [
      ann('a', '2026-07-01T00:00:00+00:00'),
      ann('b', '2026-07-02T00:00:00+00:00', { isPinned: true }),
      ann('c', '2026-07-03T00:00:00+00:00'),
      ann('d', '2026-06-01T00:00:00+00:00', { isPinned: true }),
    ]
    expect(sortAnnouncements(items).map(x => x.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const items = [ann('a', '2026-07-01T00:00:00+00:00'), ann('b', '2026-07-02T00:00:00+00:00')]
    sortAnnouncements(items)
    expect(items.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('빈 배열은 빈 배열', () => {
    expect(sortAnnouncements([])).toEqual([])
  })
})

describe('isUnread / countUnread', () => {
  const items = [
    ann('a', '2026-07-01T09:00:00+00:00'),
    ann('b', '2026-07-02T09:00:00+00:00'),
    ann('c', '2026-07-03T09:00:00+00:00'),
  ]

  it('워터마크가 null이면 전부 안읽음', () => {
    expect(isUnread(items[0], null)).toBe(true)
    expect(countUnread(items, null)).toBe(3)
  })

  it('워터마크 이후 생성된 공지만 안읽음', () => {
    expect(countUnread(items, '2026-07-02T09:00:00+00:00')).toBe(1)
  })

  it('경계: 워터마크와 같은 시각은 읽음 처리', () => {
    expect(isUnread(items[1], '2026-07-02T09:00:00+00:00')).toBe(false)
  })

  it('빈 배열은 0', () => {
    expect(countUnread([], null)).toBe(0)
  })
})

describe('summarizeAnnouncements', () => {
  // 7일 창 경계는 KST 자정: today=2026-07-02(KST) → 창 시작 = 2026-06-26T00:00+09:00 = 2026-06-25T15:00Z
  it('total / pinned / recent7d 집계', () => {
    const items = [
      ann('a', '2026-07-01T00:00:00+00:00', { isPinned: true }),
      ann('b', '2026-06-25T15:00:00+00:00'),          // = 06-26 00:00 KST, 경계 정확히 안
      ann('c', '2026-06-25T14:59:59+00:00'),          // = 06-25 23:59 KST, 창 밖
      ann('d', '2026-07-02T00:00:00+00:00'),
    ]
    expect(summarizeAnnouncements(items, '2026-07-02')).toEqual({ total: 4, pinned: 1, recent7d: 3 })
  })

  it('KST 이른 아침(00:00–08:59)에 등록된 경계일 공지도 창 안이다', () => {
    // UTC 자정 기준이었다면 빠졌을 케이스: 06-26 05:00 KST = 06-25T20:00Z
    const items = [ann('a', '2026-06-25T20:00:00+00:00')]
    expect(summarizeAnnouncements(items, '2026-07-02').recent7d).toBe(1)
  })

  it('빈 배열은 전부 0', () => {
    expect(summarizeAnnouncements([], '2026-07-02')).toEqual({ total: 0, pinned: 0, recent7d: 0 })
  })
})

describe('ANNOUNCEMENT_META', () => {
  it('모든 카테고리에 labelKey/chip/dot이 있다', () => {
    const cats: AnnouncementCategory[] = ['general', 'important', 'event']
    expect(ANNOUNCEMENT_CATEGORIES).toEqual(cats)
    for (const c of cats) {
      expect(ANNOUNCEMENT_META[c].labelKey).toBe(`ann.cat.${c}`)
      expect(ANNOUNCEMENT_META[c].chip).toBeTruthy()
      expect(ANNOUNCEMENT_META[c].dot).toBeTruthy()
    }
  })
})
