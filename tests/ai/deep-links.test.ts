import { describe, expect, it } from 'vitest'
import {
  announcementHref,
  attendanceHref,
  dashboardHref,
  kanbanHref,
  meetingHref,
  membersHref,
  minuteHref,
  myMeetingHref,
  settingsHref,
  wbsItemHref,
  weeklyHref,
} from '@/lib/ai/chat/deep-links'
import type { BotSource } from '@/lib/ai/chat/protocol'
import { verifyBotSources } from '@/lib/ai/chat/verifier'

describe('deep-links 빌더', () => {
  it('값 없는 파라미터는 쿼리에서 생략한다', () => {
    expect(meetingHref('p1')).toBe('/p/p1/meetings')
    expect(meetingHref('p1', 'm1')).toBe('/p/p1/meetings?focus=m1')
    expect(meetingHref('p1', 'm1', '2026-07-21')).toBe('/p/p1/meetings?focus=m1&date=2026-07-21')
    expect(myMeetingHref()).toBe('/meetings')
    expect(myMeetingHref('m1')).toBe('/meetings?focus=m1')
    expect(myMeetingHref('m1', '2026-07-21')).toBe('/meetings?focus=m1&date=2026-07-21')
    expect(attendanceHref('p1')).toBe('/p/p1/attendance')
    expect(attendanceHref('p1', { from: '2026-07-01', to: '2026-07-31' }))
      .toBe('/p/p1/attendance?from=2026-07-01&to=2026-07-31')
    expect(attendanceHref('p1', { team: 'ERP', type: 'annual' }))
      .toBe('/p/p1/attendance?team=ERP&type=annual')
    expect(announcementHref('p1')).toBe('/p/p1/announcements')
    expect(announcementHref('p1', 'a1')).toBe('/p/p1/announcements?focus=a1')
    expect(membersHref('p1')).toBe('/p/p1/members')
    expect(membersHref('p1', 'MES')).toBe('/p/p1/members?team=MES')
    expect(kanbanHref('p1')).toBe('/p/p1/kanban')
    expect(kanbanHref('p1', { view: 'status' })).toBe('/p/p1/kanban?view=status')
    expect(kanbanHref('p1', { view: 'owner', team: 'ERP' })).toBe('/p/p1/kanban?view=owner&team=ERP')
    expect(weeklyHref('p1')).toBe('/p/p1/weekly')
    expect(weeklyHref('p1', '2026-07-13')).toBe('/p/p1/weekly?week=2026-07-13')
    expect(wbsItemHref('p1', 'item-1')).toBe('/p/p1/wbs?focus=item-1')
    expect(minuteHref('min-1')).toBe('/minutes/min-1')
    expect(dashboardHref('p1')).toBe('/p/p1/dashboard')
    expect(settingsHref('p1')).toBe('/p/p1/settings')
  })

  it('빈 문자열 값도 생략한다', () => {
    expect(attendanceHref('p1', { from: '', to: '', team: '', type: '' })).toBe('/p/p1/attendance')
    expect(kanbanHref('p1', { view: '', team: '' })).toBe('/p/p1/kanban')
    expect(membersHref('p1', '')).toBe('/p/p1/members')
  })

  it('대상(focus) 없는 회차 날짜는 무의미하므로 생략한다', () => {
    expect(meetingHref('p1', undefined, '2026-07-21')).toBe('/p/p1/meetings')
    expect(myMeetingHref(undefined, '2026-07-21')).toBe('/meetings')
  })

  it('경로 세그먼트와 쿼리 값을 encodeURIComponent 한다', () => {
    expect(wbsItemHref('p 1', 'item/1')).toBe('/p/p%201/wbs?focus=item%2F1')
    expect(minuteHref('min 1')).toBe('/minutes/min%201')
    expect(membersHref('p1', '가공')).toBe('/p/p1/members?team=%EA%B0%80%EA%B3%B5')
    expect(meetingHref('p1', 'm&1')).toBe('/p/p1/meetings?focus=m%261')
  })
})

describe('deep-links × verifyBotSources', () => {
  const scope = { allowedProjectIds: ['p1'] }

  function source(overrides: Partial<BotSource> & Pick<BotSource, 'id' | 'domain' | 'entityType' | 'entityId' | 'href'>): BotSource {
    return {
      projectId: 'p1',
      title: '검증 대상',
      updatedAt: null,
      ...overrides,
    }
  }

  it('빌더가 만든 모든 도메인 href가 verifier를 통과한다', () => {
    const sources: BotSource[] = [
      source({ id: 's1', domain: 'wbs', entityType: 'wbs_item', entityId: 'item-1', href: wbsItemHref('p1', 'item-1') }),
      source({ id: 's2', domain: 'weekly', entityType: 'weekly_report', entityId: 'r1', href: weeklyHref('p1', '2026-07-13') }),
      source({
        id: 's3', domain: 'meetings', entityType: 'meeting_occurrence', entityId: 'm1',
        href: meetingHref('p1', 'm1', '2026-07-21'), qualifier: { occurrenceDate: '2026-07-21' },
      }),
      source({
        id: 's4', domain: 'meetings', entityType: 'meeting_occurrence', entityId: 'm1',
        href: myMeetingHref('m1', '2026-07-22'), qualifier: { occurrenceDate: '2026-07-22' },
      }),
      source({
        id: 's5', domain: 'attendance', entityType: 'attendance_record', entityId: 'a1',
        href: attendanceHref('p1', { from: '2026-07-01', to: '2026-07-31', team: '가공', type: 'trip' }),
      }),
      source({ id: 's6', domain: 'announcements', entityType: 'announcement', entityId: 'ann-1', href: announcementHref('p1', 'ann-1') }),
      source({ id: 's7', domain: 'members', entityType: 'project', entityId: 'p1', href: membersHref('p1', 'ERP') }),
      source({ id: 's8', domain: 'kanban', entityType: 'project', entityId: 'p1', href: kanbanHref('p1', { view: 'status', team: 'MES' }) }),
      source({ id: 's9', domain: 'minutes', entityType: 'minute', entityId: 'min-1', projectId: null, href: minuteHref('min-1') }),
      source({ id: 's10', domain: 'dashboard', entityType: 'project', entityId: 'p1', href: dashboardHref('p1') }),
      source({ id: 's11', domain: 'settings', entityType: 'project', entityId: 'p1', href: settingsHref('p1') }),
    ]

    const verified = verifyBotSources(sources, scope)
    expect(verified.warnings).toEqual([])
    expect(verified.sources.map(value => value.id)).toEqual(
      sources.map(value => value.id),
    )
  })

  it('minutes 단건 규칙 — 빌더 인코딩과 verifier의 encodeURIComponent 비교가 일치한다', () => {
    const minuteId = 'min 1'
    const verified = verifyBotSources([
      source({
        id: 's1', domain: 'minutes', entityType: 'minute', entityId: minuteId,
        projectId: null, href: minuteHref(minuteId),
      }),
    ], scope)
    expect(verified.warnings).toEqual([])
    expect(verified.sources).toHaveLength(1)
  })

  it('wbs focus 규칙 — 다른 항목의 focus가 달린 href는 탈락한다', () => {
    const verified = verifyBotSources([
      source({
        id: 's1', domain: 'wbs', entityType: 'wbs_item', entityId: 'item-1',
        href: wbsItemHref('p1', 'item-2'),
      }),
    ], scope)
    expect(verified.sources).toEqual([])
    expect(verified.warnings).toHaveLength(1)
  })
})
