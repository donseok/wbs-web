import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

function render(
  overrides: Partial<Meeting> = {},
  appUrl: string | null = 'https://wbs-web.vercel.app',
  kind: 'created' | 'updated' = 'created',
) {
  return renderMeetingInvite({
    kind,
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

  it('반복 종료일이 없으면 기간 꼬리표를 붙이지 않는다', () => {
    expect(render({ recurrence: 'weekly', recurrenceUntil: null }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 매주 토요일 14:00')
  })

  it('제목의 CR/LF 를 걷어낸다 — 메일 헤더는 한 줄이다', () => {
    const { subject } = render({ title: '주간\r\nBcc: evil@x.com' })
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toBe('[회의 안내] 주간 Bcc: evil@x.com · 7/25(토) 14:00')
  })
})

describe('renderMeetingInvite — 반복 기간의 연도', () => {
  it('같은 해 안에서 끝나면 연도를 생략한다', () => {
    expect(render({
      recurrence: 'weekly', meetingDate: '2026-07-25', recurrenceUntil: '2026-08-29',
    }).subject).toBe('[회의 안내] 주간 진척 점검 · 매주 토요일 14:00 (7/25~8/29)')
  })

  it('해를 넘기면 양쪽 모두에 연도를 붙인다 — 12/25~1/15 는 어느 해인지 알 수 없다', () => {
    expect(render({
      recurrence: 'weekly', meetingDate: '2026-12-25', recurrenceUntil: '2027-01-15',
    }).subject).toBe('[회의 안내] 주간 진척 점검 · 매주 금요일 14:00 (2026/12/25~2027/1/15)')
  })
})

// 이 모듈은 UTC 게터로만 날짜를 읽는다. getDay()/getDate() 로 회귀하면
// 서버 타임존에 따라 요일·날짜가 하루 어긋나는데, 기본 TZ 로만 돌리면 CI 가 이를 놓친다.
describe('renderMeetingInvite — 서버 타임존에 흔들리지 않는다', () => {
  const ORIGINAL_TZ = process.env.TZ

  // UTC-7 — 2026-07-25T00:00Z 는 이 존에서 7/24(금)이라 로컬 게터면 즉시 어긋난다.
  beforeAll(() => { process.env.TZ = 'America/Los_Angeles' })

  // TZ 가 원래 없었으면 지운다 — undefined 를 대입하면 문자열 'undefined' 가 박혀
  // 같은 워커를 쓰는 다음 테스트 파일이 UTC 폴백으로 끌려간다.
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  })

  it('음수 오프셋 타임존에서도 날짜·요일이 그대로다', () => {
    expect(render().subject).toBe('[회의 안내] 주간 진척 점검 · 7/25(토) 14:00')
  })

  it('반복 요일도 그대로다', () => {
    expect(render({ recurrence: 'weekly', recurrenceUntil: '2026-08-29' }).subject)
      .toBe('[회의 안내] 주간 진척 점검 · 매주 토요일 14:00 (7/25~8/29)')
  })

  it('매월 반복의 일자도 그대로다', () => {
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

  it('일시 줄에 날짜·요일과 시작~종료 범위를 모두 담는다', () => {
    // 제목은 시작 시각만 싣는다. 본문 일시 줄까지 시작 시각만 남으면
    // 수신자는 회의가 언제 끝나는지 어디에서도 알 수 없게 된다.
    const { text, html } = render()
    expect(text).toContain('일시: 7/25(토) 14:00~15:00')
    expect(html).toContain('>7/25(토) 14:00~15:00<')
  })

  it('반복 줄은 규칙과 기간만 담는다 — 시각을 넣으면 일시 줄과 어긋난다', () => {
    // whenLabel(제목용)을 재사용하면 '반복: 매주 토요일 14:00 (…)' 이 되어
    // 바로 위 '일시: … 14:00~15:00' 과 충돌한다. 2회차부터 30분 짧은 회의로 읽힌다.
    const { text, html } = render({ recurrence: 'weekly', recurrenceUntil: '2026-08-29' })
    expect(text).toContain('반복: 매주 토요일 (7/25~8/29)')
    expect(text).not.toContain('반복: 매주 토요일 14:00')
    expect(html).toContain('>매주 토요일 (7/25~8/29)<')
  })

  it('종일 반복 회의는 종일을 한 번만 찍는다', () => {
    const { text } = render({ startTime: null, endTime: null, recurrence: 'weekly', recurrenceUntil: '2026-08-29' })
    expect(text).toContain('일시: 7/25(토) 종일')
    expect(text.match(/종일/g)).toHaveLength(1)
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

  it('참석자가 없으면 참석자 줄을 넣지 않는다', () => {
    const out = renderMeetingInvite({
      kind: 'created', meeting: BASE, attendeeNames: [], senderName: '김철수', appUrl: null,
    })
    expect(out.text).not.toContain('참석자')
    expect(out.html).not.toContain('참석자')
  })

  it('작성자 이름이 비면 작성자 줄을 넣지 않는다', () => {
    const out = renderMeetingInvite({
      kind: 'created', meeting: BASE, attendeeNames: ['박영희'], senderName: '  ', appUrl: null,
    })
    expect(out.text).not.toContain('작성자')
    expect(out.html).not.toContain('작성자')
  })

  it('여러 줄 안건은 HTML 에서 <br> 로 끊는다 — pre-wrap 은 Outlook 에서 무시된다', () => {
    const { html, text } = render({ body: '1. 지연 항목\n2. 인력 계획' })
    expect(html).toContain('1. 지연 항목<br>2. 인력 계획')
    expect(html).not.toContain('pre-wrap')
    expect(text).toContain('1. 지연 항목\n2. 인력 계획')
  })

  it('표를 Outlook·스크린리더용으로 못박는다', () => {
    const { html } = render()
    expect(html).toContain('<table role="presentation" cellpadding="0" cellspacing="0" border="0"')
  })

  it('모든 셀에 폰트를 되풀이한다 — Outlook 은 표 셀로 폰트를 상속시키지 않는다', () => {
    const { html } = render()
    const cells = html.match(/<td style="[^"]*"/g) ?? []
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(cell).toContain('font-family:')
      expect(cell).toContain('font-size:14px')
      expect(cell).toContain('line-height:1.6')
      expect(cell).toMatch(/color:#(1f2328|6b7280)/)
    }
    // 라벨 셀의 회색은 그대로 살아 있어야 한다.
    expect(html).toContain('color:#6b7280')
    // Word 가 아는 이름이 스택 선두 — -apple-system 이 앞이면 파싱에 실패할 수 있다.
    expect(html).toContain("font-family:'Segoe UI',")
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
      kind: 'created', meeting: BASE, attendeeNames: ['<b>김철수</b>'], senderName: '<i>박영희</i>', appUrl: null,
    })
    expect(out.html).not.toContain('<b>김철수</b>')
    expect(out.html).toContain('&lt;b&gt;')
    expect(out.html).not.toContain('<i>박영희</i>')
  })

  it('text 파트는 이스케이프하지 않고 원문을 담는다', () => {
    expect(render({ title: 'A & B' }).text).toContain('A & B')
  })
})

describe('renderMeetingInvite — 종류(생성/변경)', () => {
  it('변경 메일은 제목 접두사만 [회의 변경] 으로 바꾼다', () => {
    expect(render({}, 'https://wbs-web.vercel.app', 'updated').subject)
      .toBe('[회의 변경] 주간 진척 점검 · 7/25(토) 14:00')
  })

  it('반복 회의의 변경 메일도 제목 꼬리표는 생성과 같다', () => {
    expect(render({ recurrence: 'weekly', recurrenceUntil: '2026-08-29' }, 'https://wbs-web.vercel.app', 'updated').subject)
      .toBe('[회의 변경] 주간 진척 점검 · 매주 토요일 14:00 (7/25~8/29)')
  })

  // '본문은 생성 메일과 완전히 동일하다' 가 요구사항이다. 변경 메일에만 안내 문구나
  // 변경 전/후 비교를 덧붙이면 여기서 깨진다 — 그 판단은 코드가 아니라 사람이 해야 한다.
  it('본문(html·text)은 생성 메일과 글자 하나까지 같다', () => {
    const created = render({}, 'https://wbs-web.vercel.app', 'created')
    const updated = render({}, 'https://wbs-web.vercel.app', 'updated')
    expect(updated.html).toBe(created.html)
    expect(updated.text).toBe(created.text)
  })

  it('제목도 접두사를 뺀 나머지는 같다', () => {
    const created = render({}, null, 'created')
    const updated = render({}, null, 'updated')
    expect(updated.subject.replace('[회의 변경] ', ''))
      .toBe(created.subject.replace('[회의 안내] ', ''))
  })

  it('변경 메일도 제목의 CR/LF 를 걷어낸다', () => {
    const { subject } = render({ title: '주간\r\nBcc: evil@x.com' }, null, 'updated')
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toBe('[회의 변경] 주간 Bcc: evil@x.com · 7/25(토) 14:00')
  })
})
