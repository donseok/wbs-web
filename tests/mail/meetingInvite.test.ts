import { describe, it, expect } from 'vitest'
import type { Meeting } from '@/lib/domain/types'
import { renderMeetingInvite } from '@/lib/mail/meetingInvite'

const BASE: Meeting = {
  id: 'm1', projectId: 'p1', title: '주간 진척 점검',
  meetingDate: '2026-07-25', startTime: '14:00', endTime: '15:00',
  location: '3층 회의실', category: 'routine', body: '지연 항목 점검',
  recurrence: 'none', recurrenceUntil: null,
  createdBy: 'u1', createdByName: '김철수',
  createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z',
  attendeeIds: [],
}

function render(overrides: Partial<Meeting> = {}, appUrl: string | null = 'https://wbs-web.vercel.app') {
  return renderMeetingInvite({
    meeting: { ...BASE, ...overrides },
    attendeeNames: ['김철수', '박영희'],
    senderName: '김철수',
    appUrl,
  })
}

describe('renderMeetingInvite — 제목', () => {
  it('단발 회의는 날짜·요일·시각을 담는다', () => {
    expect(render().subject).toBe('[회의 안내] 주간 진척 점검 · 7/25(토) 14:00')
  })

  it('종일 회의는 시각 대신 종일로 표기한다', () => {
    expect(render({ startTime: null, endTime: null }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 7/25(토) 종일')
  })

  it('매주 반복은 요일과 기간을 담는다', () => {
    expect(render({ recurrence: 'weekly', recurrenceUntil: '2026-08-29' }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 매주 토요일 14:00 (7/25~8/29)')
  })

  it('격주 반복도 요일을 담는다', () => {
    expect(render({ recurrence: 'biweekly', recurrenceUntil: '2026-08-29' }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 격주 토요일 14:00 (7/25~8/29)')
  })

  it('매일 반복은 요일을 붙이지 않는다', () => {
    expect(render({ recurrence: 'daily', recurrenceUntil: '2026-08-29' }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 매일 14:00 (7/25~8/29)')
  })

  it('매월 반복은 일자를 붙인다', () => {
    expect(render({ recurrence: 'monthly', recurrenceUntil: '2026-12-25' }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 매월 25일 14:00 (7/25~12/25)')
  })
})

describe('renderMeetingInvite — 본문', () => {
  it('text 파트를 항상 만든다 — 없으면 스팸 점수가 올라간다', () => {
    const { text } = render()
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('주간 진척 점검')
    expect(text).toContain('3층 회의실')
    expect(text).toContain('지연 항목 점검')
  })

  it('구분 라벨을 한국어로 표기한다', () => {
    expect(render().text).toContain('정례')
  })

  it('참석자 명단과 작성자를 담는다', () => {
    const { text } = render()
    expect(text).toContain('김철수, 박영희')
    expect(text).toContain('김철수')
  })

  it('장소가 없으면 장소 줄을 아예 넣지 않는다', () => {
    const { text, html } = render({ location: null })
    expect(text).not.toContain('장소')
    expect(html).not.toContain('장소')
  })

  it('안건이 비어 있으면 안건 줄을 넣지 않는다', () => {
    const { text, html } = render({ body: '   ' })
    expect(text).not.toContain('안건')
    expect(html).not.toContain('안건')
  })

  it('appUrl 이 있으면 회의일정 링크를 넣는다', () => {
    const { html, text } = render()
    expect(html).toContain('https://wbs-web.vercel.app/p/p1/meetings')
    expect(text).toContain('https://wbs-web.vercel.app/p/p1/meetings')
  })

  it('appUrl 이 null 이면 링크를 생략한다', () => {
    const { html, text } = render({}, null)
    expect(html).not.toContain('href="http')
    expect(text).not.toContain('http')
  })
})

describe('renderMeetingInvite — 이스케이프', () => {
  it('제목·장소·안건의 HTML 을 이스케이프한다', () => {
    const { html } = render({
      title: '<script>alert(1)</script>',
      location: 'A & B "회의실"',
      body: "위험 <img src=x onerror=1> '따옴표'",
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A &amp; B')
  })

  it('참석자 이름도 이스케이프한다', () => {
    const out = renderMeetingInvite({
      meeting: BASE, attendeeNames: ['<b>김철수</b>'], senderName: '<i>박영희</i>', appUrl: null,
    })
    expect(out.html).not.toContain('<b>김철수</b>')
    expect(out.html).toContain('&lt;b&gt;')
    expect(out.html).not.toContain('<i>박영희</i>')
  })

  it('text 파트는 이스케이프하지 않고 원문을 담는다', () => {
    expect(render({ title: 'A & B' }).text).toContain('A & B')
  })
})
