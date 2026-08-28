import { describe, it, expect } from 'vitest'
import {
  ANNOUNCEMENT_META, ANNOUNCEMENT_CATEGORIES,
  sortAnnouncements, isUnread, countUnread, summarizeAnnouncements,
  announcementStatus, isPublishedNow,
  announcementMilestones, mergeMilestonePoints, validateAnnouncementInput,
} from '@/lib/domain/announcements'
import type { MilestonePoint } from '@/lib/domain/dashboard'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

function ann(id: string, createdAt: string, opts: Partial<Announcement> = {}): Announcement {
  return {
    id,
    projectId: 'p1',
    title: `공지 ${id}`,
    body: '',
    category: 'general',
    isPinned: false,
    publishFrom: null,
    publishTo: null,
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

describe('announcementStatus / isPublishedNow', () => {
  const today = '2026-07-05'

  it('시작일 전이면 scheduled(비노출)', () => {
    const a = ann('a', '2026-07-01T00:00:00+00:00', { publishFrom: '2026-07-10', publishTo: '2026-07-20' })
    expect(announcementStatus(a, today)).toBe('scheduled')
    expect(isPublishedNow(a, today)).toBe(false)
  })

  it('종료일 후면 expired(비노출)', () => {
    const a = ann('a', '2026-07-01T00:00:00+00:00', { publishFrom: '2026-06-01', publishTo: '2026-07-01' })
    expect(announcementStatus(a, today)).toBe('expired')
    expect(isPublishedNow(a, today)).toBe(false)
  })

  it('기간 안이면 active(노출)', () => {
    const a = ann('a', '2026-07-01T00:00:00+00:00', { publishFrom: '2026-07-01', publishTo: '2026-07-31' })
    expect(announcementStatus(a, today)).toBe('active')
    expect(isPublishedNow(a, today)).toBe(true)
  })

  it('경계 포함: 시작일 당일·종료일 당일 모두 active', () => {
    expect(isPublishedNow(ann('s', '', { publishFrom: today, publishTo: '2026-07-31' }), today)).toBe(true)
    expect(isPublishedNow(ann('e', '', { publishFrom: '2026-07-01', publishTo: today }), today)).toBe(true)
  })

  it('기간 null(legacy)은 무기한 노출', () => {
    expect(isPublishedNow(ann('a', '', { publishFrom: null, publishTo: null }), today)).toBe(true)
  })

  it('한쪽만 지정: from만 있으면 그 이후 상시, to만 있으면 그 이전 상시', () => {
    expect(isPublishedNow(ann('f', '', { publishFrom: '2026-07-01', publishTo: null }), today)).toBe(true)
    expect(isPublishedNow(ann('f', '', { publishFrom: '2026-07-10', publishTo: null }), today)).toBe(false)
    expect(isPublishedNow(ann('t', '', { publishFrom: null, publishTo: '2026-07-31' }), today)).toBe(true)
    expect(isPublishedNow(ann('t', '', { publishFrom: null, publishTo: '2026-07-01' }), today)).toBe(false)
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

describe('announcementMilestones — milestoneDate 가 있는 공지만 타임라인 점으로', () => {
  const TODAY = '2026-08-28'
  it('날짜 없는 공지는 제외, 있는 공지는 kind=announcement 점', () => {
    const pts = announcementMilestones([
      ann('a', '2026-08-27T00:00:00+00:00', { title: '공장 현업 설명회', milestoneDate: '2026-09-02' }),
      ann('b', '2026-08-27T00:00:00+00:00', { milestoneDate: null }),
      ann('c', '2026-08-27T00:00:00+00:00'),
    ], TODAY)
    expect(pts).toHaveLength(1)
    expect(pts[0]).toMatchObject({ id: 'a', name: '공장 현업 설명회', date: '2026-09-02', kind: 'announcement', status: 'upcoming', dday: 5 })
  })
  it('지난 행사는 done(경과가 아니라 치러진 것), 오늘은 upcoming D-0', () => {
    const pts = announcementMilestones([
      ann('p', '2026-07-01T00:00:00+00:00', { milestoneDate: '2026-07-05' }),
      ann('t', '2026-07-01T00:00:00+00:00', { milestoneDate: '2026-08-28' }),
    ], TODAY)
    expect(pts.find(p => p.id === 'p')).toMatchObject({ status: 'done', dday: -54 })
    expect(pts.find(p => p.id === 't')).toMatchObject({ status: 'upcoming', dday: 0 })
  })
})

describe('mergeMilestonePoints — WBS 점과 공지 점을 날짜순으로', () => {
  it('날짜 오름차순, 같은 날짜면 WBS 먼저(입력 순서 유지)', () => {
    const wbs: MilestonePoint[] = [
      { id: 'w2', name: '중간보고', date: '2026-09-10', status: 'upcoming', dday: 13 },
      { id: 'w1', name: '착수보고', date: '2026-07-10', status: 'done', dday: -49 },
    ]
    const ann1: MilestonePoint[] = [
      { id: 'a1', name: '본사 현업 설명회', date: '2026-09-10', status: 'upcoming', dday: 13, kind: 'announcement' },
      { id: 'a0', name: '공장 현업 설명회', date: '2026-09-02', status: 'upcoming', dday: 5, kind: 'announcement' },
    ]
    expect(mergeMilestonePoints(wbs, ann1).map(p => p.id)).toEqual(['w1', 'a0', 'w2', 'a1'])
  })
})

describe('validateAnnouncementInput — 마일스톤 일자', () => {
  const base = { title: '제목', body: '', category: 'general' as AnnouncementCategory, isPinned: false, publishFrom: '2026-08-28', publishTo: '2026-09-10' }
  it('null 이면 통과(표시 안 함)', () => {
    expect(validateAnnouncementInput({ ...base, milestoneDate: null })).toBeNull()
  })
  it('형식이 틀리거나 실재하지 않는 날짜는 거부', () => {
    expect(validateAnnouncementInput({ ...base, milestoneDate: '2026-9-2' })).toMatch(/마일스톤/)
    expect(validateAnnouncementInput({ ...base, milestoneDate: '2026-02-30' })).toMatch(/마일스톤/)
  })
  it('빈 문자열은 "체크했는데 날짜 없음" — 거부', () => {
    expect(validateAnnouncementInput({ ...base, milestoneDate: '' })).toMatch(/마일스톤/)
  })
  it('기존 규칙(제목·기간)은 그대로', () => {
    expect(validateAnnouncementInput({ ...base, title: ' ', milestoneDate: null })).toMatch(/제목/)
    expect(validateAnnouncementInput({ ...base, publishFrom: '2026-09-11', milestoneDate: null })).toMatch(/종료일/)
  })
})
