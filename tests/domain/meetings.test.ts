import { describe, it, expect } from 'vitest'
import {
  expandMeetings, occurrencesByDate, sortOccurrences, canEditMeeting, summarizeMeetings,
  meetingEditHref, MEETING_CATEGORIES,
} from '@/lib/domain/meetings'
import type { Meeting, MeetingException } from '@/lib/domain/types'

function mtg(id: string, date: string, opts: Partial<Meeting> = {}): Meeting {
  return {
    id, projectId: 'p1', title: `회의 ${id}`, meetingDate: date,
    startTime: '10:00', endTime: '11:00', location: null, category: 'general',
    body: '', recurrence: 'none', recurrenceUntil: null,
    createdBy: 'u1', createdByName: '홍길동', createdAt: `${date}T00:00:00+00:00`,
    updatedAt: `${date}T00:00:00+00:00`, attendeeIds: [], ...opts,
  }
}
const G = (m: Meeting[], ex: MeetingException[], s: string, e: string) =>
  expandMeetings(m, ex, s, e).map(o => o.occurrenceDate)

describe('expandMeetings — 단일/범위', () => {
  it('비반복 회의는 범위 안이면 1건, 밖이면 0건', () => {
    expect(G([mtg('a', '2026-07-10')], [], '2026-07-01', '2026-07-31')).toEqual(['2026-07-10'])
    expect(G([mtg('a', '2026-07-10')], [], '2026-08-01', '2026-08-31')).toEqual([])
  })
  it('occurrenceId = seriesId:date', () => {
    const [o] = expandMeetings([mtg('a', '2026-07-10')], [], '2026-07-01', '2026-07-31')
    expect(o.occurrenceId).toBe('a:2026-07-10')
    expect(o.seriesId).toBe('a')
  })
})

describe('expandMeetings — 주간/격주', () => {
  it('매주: 앵커부터 7일 간격, 범위로 클램프', () => {
    const m = mtg('w', '2026-07-06', { recurrence: 'weekly', recurrenceUntil: '2026-08-31' })
    expect(G([m], [], '2026-07-01', '2026-07-31'))
      .toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
  })
  it('매주: 과거 앵커라도 이번 달만 전개(앵커가 범위 앞이어도 fast-forward)', () => {
    const m = mtg('w', '2026-01-05', { recurrence: 'weekly', recurrenceUntil: null })
    expect(G([m], [], '2026-07-06', '2026-07-12')).toEqual(['2026-07-06'])
  })
  it('격주: 14일 간격, 앵커 위상 유지', () => {
    const m = mtg('b', '2026-07-06', { recurrence: 'biweekly', recurrenceUntil: '2026-09-30' })
    expect(G([m], [], '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-20'])
  })
  it('격주: 연 경계를 넘어도 위상 유지', () => {
    const m = mtg('b', '2025-12-22', { recurrence: 'biweekly', recurrenceUntil: '2026-02-28' })
    expect(G([m], [], '2026-01-01', '2026-01-31')).toEqual(['2026-01-05', '2026-01-19'])
  })
})

describe('expandMeetings — 매월(31일 skip 규칙)', () => {
  it('매월 31일: 31일 없는 달은 건너뜀', () => {
    const m = mtg('mo', '2026-01-31', { recurrence: 'monthly', recurrenceUntil: '2026-12-31' })
    // 2월(없음), 4·6·9·11월(30일, 없음) skip → 1,3,5,7,8,10,12월만
    expect(G([m], [], '2026-01-01', '2026-12-31'))
      .toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', '2026-12-31'])
  })
  it('매월 15일: 매달 존재', () => {
    const m = mtg('mo', '2026-06-15', { recurrence: 'monthly', recurrenceUntil: '2026-08-31' })
    expect(G([m], [], '2026-06-01', '2026-08-31')).toEqual(['2026-06-15', '2026-07-15', '2026-08-15'])
  })
  it('매월 29일: 윤년 2월29 포함, 평년이면 skip', () => {
    const leap = mtg('l', '2024-01-29', { recurrence: 'monthly', recurrenceUntil: '2024-03-31' })
    expect(G([leap], [], '2024-02-01', '2024-02-29')).toEqual(['2024-02-29'])
    const nonleap = mtg('n', '2026-01-29', { recurrence: 'monthly', recurrenceUntil: '2026-03-31' })
    expect(G([nonleap], [], '2026-02-01', '2026-02-28')).toEqual([])
  })
})

describe('expandMeetings — until 포함 & 예외', () => {
  it('recurrence_until는 포함(inclusive)', () => {
    const m = mtg('w', '2026-07-06', { recurrence: 'weekly', recurrenceUntil: '2026-07-20' })
    expect(G([m], [], '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-13', '2026-07-20'])
  })
  it('취소 예외 회차는 제외', () => {
    const m = mtg('w', '2026-07-06', { recurrence: 'weekly', recurrenceUntil: '2026-07-31' })
    const ex: MeetingException[] = [{ meetingId: 'w', occurrenceDate: '2026-07-13', kind: 'cancelled' }]
    expect(G([m], ex, '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-20', '2026-07-27'])
  })
})

describe('sortOccurrences', () => {
  it('종일(null start) 먼저 → 시각 오름차순', () => {
    const m = [
      mtg('c', '2026-07-10', { startTime: '18:00' }),
      mtg('a', '2026-07-10', { startTime: null, endTime: null }),
      mtg('b', '2026-07-10', { startTime: '09:00' }),
    ]
    const occ = expandMeetings(m, [], '2026-07-10', '2026-07-10')
    expect(sortOccurrences(occ).map(o => o.seriesId)).toEqual(['a', 'b', 'c'])
  })
})

describe('occurrencesByDate', () => {
  it('날짜별로 버킷팅', () => {
    const occ = expandMeetings(
      [mtg('a', '2026-07-10'), mtg('b', '2026-07-10'), mtg('c', '2026-07-11')],
      [], '2026-07-01', '2026-07-31',
    )
    const by = occurrencesByDate(occ)
    expect(Object.keys(by).sort()).toEqual(['2026-07-10', '2026-07-11'])
    expect(by['2026-07-10'].map(o => o.seriesId).sort()).toEqual(['a', 'b'])
    expect(by['2026-07-11']).toHaveLength(1)
  })
})

describe('canEditMeeting', () => {
  it('작성자 본인 → true', () => expect(canEditMeeting({ createdBy: 'u1' }, 'u1', 'team_editor')).toBe(true))
  it('pmo_admin → true(남의 것도)', () => expect(canEditMeeting({ createdBy: 'u1' }, 'u2', 'pmo_admin')).toBe(true))
  it('제3자 team_editor → false', () => expect(canEditMeeting({ createdBy: 'u1' }, 'u2', 'team_editor')).toBe(false))
  it('탈퇴자(null) → pmo만', () => {
    expect(canEditMeeting({ createdBy: null }, 'u2', 'team_editor')).toBe(false)
    expect(canEditMeeting({ createdBy: null }, 'u2', 'pmo_admin')).toBe(true)
  })
  it('비로그인 → false', () => expect(canEditMeeting({ createdBy: 'u1' }, null, null)).toBe(false))
})

describe('MEETING_CATEGORIES', () => {
  it('6종', () => expect(MEETING_CATEGORIES).toHaveLength(6))
})

describe('summarizeMeetings', () => {
  it('오늘/향후7일/전체 카운트', () => {
    const occ = expandMeetings([
      mtg('a', '2026-07-03'), mtg('b', '2026-07-05'), mtg('c', '2026-07-20'),
    ], [], '2026-07-01', '2026-07-31')
    const s = summarizeMeetings(occ, '2026-07-03')
    expect(s.total).toBe(3)
    expect(s.today).toBe(1)
    expect(s.upcoming7d).toBe(2) // 07-03(포함) ~ 07-09: a,b
  })
})

describe('meetingEditHref', () => {
  it('회차 날짜가 있으면 focus/edit/date 를 모두 싣는다', () => {
    expect(meetingEditHref('p1', 'm1', '2026-07-21'))
      .toBe('/p/p1/meetings?focus=m1&edit=1&date=2026-07-21')
  })
  it('회차 날짜가 없으면 date 를 생략한다(회의 페이지가 시리즈 기준일로 폴백)', () => {
    expect(meetingEditHref('p1', 'm1')).toBe('/p/p1/meetings?focus=m1&edit=1')
    expect(meetingEditHref('p1', 'm1', null)).toBe('/p/p1/meetings?focus=m1&edit=1')
  })
})
