# 회의 안내 메일 자동 발송 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의일정에서 새 회의를 저장할 때, 선택한 참석자에게 회의 안내 메일을 자동으로 발송한다.

**Architecture:** 발송을 `createMeeting`에서 완전히 분리한다. 모달이 저장 성공을 받은 뒤 별도 서버 액션 `notifyMeetingCreated(meetingId)`를 호출하므로, 메일이 실패해도 회의 데이터는 이미 커밋되어 있다. 순수 함수(수신자 분류·메일 렌더·결과 해석)와 부작용(SMTP 전송)을 파일 단위로 갈라, SMTP 없이 대부분을 테스트한다.

**Tech Stack:** Next.js 15 App Router (Server Actions), TypeScript, Supabase, nodemailer 9 + Gmail SMTP, vitest.

**설계 문서:** `docs/superpowers/specs/2026-07-22-meeting-invite-email-design.md`

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/mail/recipients.ts` (신규) | 참석자 → 유효/제외 분류. 순수 |
| `src/lib/mail/meetingInvite.ts` (신규) | 회의 → `{subject, html, text}`. 순수 |
| `src/lib/mail/outcome.ts` (신규) | 발송 결과 → 화면 표시 방식. 순수 |
| `src/lib/mail/transport.ts` (신규) | nodemailer 트랜스포트. **유일한 부작용 지점** |
| `src/app/actions/meetingNotify.ts` (신규) | 서버 액션 — 권한→조회→분류→렌더→전송 |
| `src/lib/i18n/dict/meetings.ts` (수정) | 신규 문구 ko/en |
| `src/components/meetings/MeetingFormModal.tsx` (수정) | 체크박스·결과 패널·폼 잠금 |
| `src/app/actions/meetings.ts` | **건드리지 않는다** |

순수 함수 3개를 먼저 만들고(Task 2·3·4), 부작용과 액션을 뒤에 얹는다(Task 5·6). UI는 마지막(Task 8).

---

## Task 1: 의존성과 환경변수

**Files:**
- Modify: `package.json`
- Modify: `.env.local.example`

- [ ] **Step 1: nodemailer 설치**

```bash
npm install nodemailer@9
npm install --save-dev @types/nodemailer@8
```

`nodemailer`는 `types`/`typings` 필드가 없어 타입이 번들되지 않는다. `@types/nodemailer`가 반드시 필요하다.

- [ ] **Step 2: 설치 확인**

Run: `node -e "console.log(require('nodemailer/package.json').version)"`
Expected: `9.x.x` 출력

- [ ] **Step 3: `.env.local.example` 끝에 추가**

```bash
# ── 회의 안내 메일 (Gmail SMTP) ──
# SMTP_PASS 는 Google '앱 비밀번호'다. 계정 비밀번호가 아니며 2단계 인증이 켜져 있어야 발급된다.
# 미설정이면 발송 액션이 throw 하지 않고 { ok:false } 를 반환한다(로컬·Preview 정상 동작).
SMTP_USER=
SMTP_PASS=
MAIL_FROM_NAME=D-CUBE 회의알림
# 메일 본문 링크의 절대 주소. 없으면 VERCEL_PROJECT_PRODUCTION_URL 로 폴백, 그것도 없으면 링크 생략.
NEXT_PUBLIC_APP_URL=
```

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json .env.local.example
git commit -m "chore(mail): nodemailer 의존성과 SMTP 환경변수 예시 추가"
```

---

## Task 2: `classifyRecipients` — 수신자 분류

참석자 중 누구에게 실제로 보낼 수 있는지 가른다.
`0011_member_email_check`의 이메일 CHECK가 `NOT VALID`이고 백필이 실행된 적이 없어
**형식이 깨진 이메일이 DB에 존재할 수 있다.** 그대로 nodemailer에 넘기면 메일 한 통 전체가
거절되어 멀쩡한 참석자까지 못 받는다. 이 함수가 그것을 막는다.

**Files:**
- Create: `src/lib/mail/recipients.ts`
- Test: `tests/mail/recipients.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/mail/recipients.test.ts
import { describe, it, expect } from 'vitest'
import type { MeetingAttendeeInfo } from '@/lib/domain/types'
import { classifyRecipients } from '@/lib/mail/recipients'

function att(name: string, email: string | null): MeetingAttendeeInfo {
  return { id: `id-${name}`, name, teamCode: null, email }
}

describe('classifyRecipients', () => {
  it('정상 이메일은 valid 로 분류한다', () => {
    const res = classifyRecipients([att('김철수', 'chulsoo@dongkuk.com')])
    expect(res.valid).toEqual([{ name: '김철수', email: 'chulsoo@dongkuk.com' }])
    expect(res.skipped).toEqual([])
  })

  it('null 이메일은 no_email 로 제외한다', () => {
    const res = classifyRecipients([att('박영희', null)])
    expect(res.valid).toEqual([])
    expect(res.skipped).toEqual([{ name: '박영희', reason: 'no_email' }])
  })

  it('공백뿐인 이메일도 no_email 로 제외한다', () => {
    const res = classifyRecipients([att('이민수', '   ')])
    expect(res.skipped).toEqual([{ name: '이민수', reason: 'no_email' }])
  })

  it('형식이 깨진 이메일은 invalid_email 로 제외한다 — 0011 백필 미실행 대비', () => {
    const broken = ['no-at-sign', 'a@b', 'a@@b.com', 'a b@c.com', '@dongkuk.com', 'a@.com']
    const res = classifyRecipients(broken.map((e, i) => att(`X${i}`, e)))
    expect(res.valid).toEqual([])
    expect(res.skipped.every(s => s.reason === 'invalid_email')).toBe(true)
    expect(res.skipped).toHaveLength(broken.length)
  })

  it('이메일을 소문자로 정규화하고 앞뒤 공백을 제거한다', () => {
    const res = classifyRecipients([att('최지훈', '  JiHun@Dongkuk.COM ')])
    expect(res.valid).toEqual([{ name: '최지훈', email: 'jihun@dongkuk.com' }])
  })

  it('같은 주소가 여러 번 나오면 한 번만 남긴다', () => {
    const res = classifyRecipients([att('A', 'same@dongkuk.com'), att('B', 'SAME@dongkuk.com')])
    expect(res.valid).toEqual([{ name: 'A', email: 'same@dongkuk.com' }])
    expect(res.skipped).toEqual([])
  })

  it('섞여 있어도 순서를 보존하며 분류한다', () => {
    const res = classifyRecipients([att('A', 'a@dongkuk.com'), att('B', null), att('C', 'c@dongkuk.com')])
    expect(res.valid.map(v => v.name)).toEqual(['A', 'C'])
    expect(res.skipped.map(s => s.name)).toEqual(['B'])
  })

  it('빈 배열은 빈 결과를 낸다', () => {
    expect(classifyRecipients([])).toEqual({ valid: [], skipped: [] })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/mail/recipients.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/mail/recipients"`

- [ ] **Step 3: 구현**

```ts
// src/lib/mail/recipients.ts
import type { MeetingAttendeeInfo } from '@/lib/domain/types'

/** 발송 전 제외 사유. 'rejected' 는 전송 후 SMTP 응답으로만 붙는다(여기서는 나오지 않는다). */
export type SkipReason = 'no_email' | 'invalid_email' | 'rejected'

export interface Recipient { name: string; email: string }
export interface Classified {
  valid: Recipient[]
  skipped: { name: string; reason: Exclude<SkipReason, 'rejected'> }[]
}

// 로컬파트@도메인.TLD — 공백/중복@ 를 배제하고 TLD 2자 이상을 요구한다.
// RFC 전체를 구현하지 않는다. 목적은 '이 주소를 SMTP 에 넘겨도 한 통 전체가 거절되지 않는가' 뿐이다.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/

/**
 * 참석자를 발송 가능/제외로 가른다.
 * 이메일은 소문자·trim 으로 정규화하고, 같은 주소가 중복되면 처음 것만 남긴다
 * (같은 사람이 두 멤버 행으로 들어와 메일을 두 번 받는 일을 막는다).
 */
export function classifyRecipients(attendees: MeetingAttendeeInfo[]): Classified {
  const valid: Recipient[] = []
  const skipped: Classified['skipped'] = []
  const seen = new Set<string>()

  for (const a of attendees) {
    const raw = a.email?.trim() ?? ''
    if (!raw) { skipped.push({ name: a.name, reason: 'no_email' }); continue }
    const email = raw.toLowerCase()
    if (!EMAIL_RE.test(email)) { skipped.push({ name: a.name, reason: 'invalid_email' }); continue }
    if (seen.has(email)) continue
    seen.add(email)
    valid.push({ name: a.name, email })
  }
  return { valid, skipped }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/mail/recipients.test.ts`
Expected: PASS — 8 passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/mail/recipients.ts tests/mail/recipients.test.ts
git commit -m "feat(mail): 참석자 수신자 분류 — 깨진 이메일이 메일 전체를 거절시키는 것 방지"
```

---

## Task 3: `renderMeetingInvite` — 메일 본문 렌더

회의 하나를 `{subject, html, text}`로 바꾼다. 순수 함수이므로 SMTP 없이 전부 테스트한다.

**날짜는 반드시 UTC로 파싱한다.** `new Date('2026-07-25')`는 UTC 자정으로 파싱되지만
`getDay()`는 로컬 타임존 기준이라 서버 타임존에 따라 요일이 하루 어긋난다. `getUTCDay()`를 쓴다.
`expandMeetings`(`src/lib/domain/meetings.ts`)가 이미 같은 규칙을 쓴다.

**Files:**
- Create: `src/lib/mail/meetingInvite.ts`
- Test: `tests/mail/meetingInvite.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/mail/meetingInvite.test.ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/mail/meetingInvite.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/mail/meetingInvite"`

- [ ] **Step 3: 구현**

```ts
// src/lib/mail/meetingInvite.ts
import { t, type DictKey } from '@/lib/i18n/dict'
import type { Meeting } from '@/lib/domain/types'

// 메일 본문은 한국어 고정 — 수신자의 언어를 알 수 없고 발신자 로케일을 쓰는 것은 틀린 답이다.
const LOCALE = 'ko' as const

// src/lib/report/weekly.ts 에도 같은 배열이 있으나 export 되지 않으며,
// 메일 모듈이 보고서 모듈에 의존하는 편이 중복보다 나쁘다.
const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 'YYYY-MM-DD' → UTC Date. 로컬 파싱은 서버 타임존에 따라 요일이 하루 어긋난다. */
function utcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** '7/25(토)' */
function fmtDateDow(iso: string): string {
  const d = utcDate(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW_KR[d.getUTCDay()]})`
}

/** '7/25' */
function fmtDateShort(iso: string): string {
  const d = utcDate(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** '14:00' 또는 '14:00~15:00', 종일이면 '종일'. */
function fmtTime(meeting: Meeting): string {
  if (!meeting.startTime) return t(LOCALE, 'meet.allDay')
  return meeting.endTime ? `${meeting.startTime}~${meeting.endTime}` : meeting.startTime
}

/** 제목용 시각 — 범위 없이 시작 시각만. */
function fmtTimeShort(meeting: Meeting): string {
  return meeting.startTime ?? t(LOCALE, 'meet.allDay')
}

/**
 * 반복 규칙의 사람이 읽는 표기.
 * 주/격주는 요일, 매월은 일자를 덧붙인다 — '매주'만으로는 어느 요일인지 알 수 없다.
 */
function fmtRecurrence(meeting: Meeting): string {
  const label = t(LOCALE, `meet.recur.${meeting.recurrence}` as DictKey)
  const d = utcDate(meeting.meetingDate)
  if (meeting.recurrence === 'weekly' || meeting.recurrence === 'biweekly') {
    return `${label} ${DOW_KR[d.getUTCDay()]}요일`
  }
  if (meeting.recurrence === 'monthly') return `${label} ${d.getUTCDate()}일`
  return label
}

/** 제목 꼬리표 — 단발이면 날짜, 반복이면 규칙과 기간. */
function whenLabel(meeting: Meeting): string {
  const time = fmtTimeShort(meeting)
  if (meeting.recurrence === 'none') return `${fmtDateDow(meeting.meetingDate)} ${time}`
  const until = meeting.recurrenceUntil
    ? ` (${fmtDateShort(meeting.meetingDate)}~${fmtDateShort(meeting.recurrenceUntil)})`
    : ''
  return `${fmtRecurrence(meeting)} ${time}${until}`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

type Row = { label: string; value: string }

export function renderMeetingInvite(input: {
  meeting: Meeting
  attendeeNames: string[]
  senderName: string
  appUrl: string | null
}): { subject: string; html: string; text: string } {
  const { meeting, attendeeNames, senderName, appUrl } = input

  const subject = `[회의 안내] ${meeting.title} · ${whenLabel(meeting)}`
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/p/${meeting.projectId}/meetings` : null

  // 값이 빈 항목은 줄 자체를 만들지 않는다 — 빈 항목을 나열하지 않는다.
  const rows: Row[] = [
    { label: '일시', value: `${fmtDateDow(meeting.meetingDate)} ${fmtTime(meeting)}` },
  ]
  if (meeting.recurrence !== 'none') rows.push({ label: '반복', value: whenLabel(meeting) })
  if (meeting.location?.trim()) rows.push({ label: '장소', value: meeting.location.trim() })
  rows.push({ label: '구분', value: t(LOCALE, `meet.cat.${meeting.category}` as DictKey) })
  if (attendeeNames.length) rows.push({ label: '참석자', value: attendeeNames.join(', ') })
  rows.push({ label: '작성자', value: senderName })
  if (meeting.body.trim()) rows.push({ label: '안건', value: meeting.body.trim() })

  const text = [
    `${meeting.title}`,
    '',
    ...rows.map(r => `${r.label}: ${r.value}`),
    ...(link ? ['', `회의일정에서 보기: ${link}`] : []),
  ].join('\n')

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1f2328;max-width:560px">',
    `<h2 style="margin:0 0 16px;font-size:18px">${esc(meeting.title)}</h2>`,
    '<table style="border-collapse:collapse;width:100%">',
    ...rows.map(r =>
      `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(r.label)}</td>` +
      `<td style="padding:6px 0;white-space:pre-wrap">${esc(r.value)}</td></tr>`),
    '</table>',
    ...(link
      ? [`<p style="margin:20px 0 0"><a href="${esc(link)}" style="color:#2563eb">회의일정에서 보기</a></p>`]
      : []),
    '</div>',
  ].join('')

  return { subject, html, text }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/mail/meetingInvite.test.ts`
Expected: PASS — 16 passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/mail/meetingInvite.ts tests/mail/meetingInvite.test.ts
git commit -m "feat(mail): 회의 안내 메일 렌더 — HTML/텍스트 두 파트 + UTC 요일 계산"
```

---

## Task 4: i18n 문구

Task 5의 `describeNotifyResult`가 `DictKey` 타입으로 이 키들을 참조하므로 **먼저 만들어야 한다.**
없으면 타입 에러가 난다.

`meetingsEn`은 `Record<keyof typeof meetingsKo, string>`으로 선언되어 있어 **ko에만 넣으면 컴파일이 깨진다.**
ko/en 양쪽에 같은 키를 넣는다.

**Files:**
- Modify: `src/lib/i18n/dict/meetings.ts`

- [ ] **Step 1: ko 블록에 추가**

`'meet.deleteFailed': '삭제에 실패했습니다.',` 바로 다음 줄(`} as const` 직전)에 삽입한다.

```ts
  'meet.form.notify': '참석자에게 회의 안내 메일 보내기',
  'meet.form.notifyNoAttendees': '참석자를 선택하면 메일을 보낼 수 있습니다.',
  'meet.notify.sending': '메일 보내는 중…',
  'meet.notify.toastTitle': '메일 발송 완료',
  'meet.notify.sent': '참석자 {n}명에게 회의 안내 메일을 보냈습니다.',
  'meet.notify.partial': '회의가 저장되었습니다. {n}명에게 발송했고, 다음 참석자는 제외했습니다 — {names}',
  'meet.notify.noneSent': '회의가 저장되었습니다. 이메일이 있는 참석자가 없어 메일을 보내지 않았습니다.',
  'meet.notify.failed': '회의는 정상 저장되었습니다. 다만 메일 발송에 실패했습니다 — {error}',
  'meet.notify.unknown': '회의는 저장되었으나 발송 결과를 확인하지 못했습니다.',
  'meet.notify.reason.no_email': '이메일 없음',
  'meet.notify.reason.invalid_email': '이메일 형식 오류',
  'meet.notify.reason.rejected': '수신 거부됨',
```

- [ ] **Step 2: en 블록에 추가**

`'meet.deleteFailed': 'Failed to delete.',` 바로 다음 줄(`}` 직전)에 삽입한다.

```ts
  'meet.form.notify': 'Email the meeting details to attendees',
  'meet.form.notifyNoAttendees': 'Select attendees to enable email.',
  'meet.notify.sending': 'Sending email…',
  'meet.notify.toastTitle': 'Email sent',
  'meet.notify.sent': 'Meeting details sent to {n} attendee(s).',
  'meet.notify.partial': 'Meeting saved. Sent to {n}; excluded — {names}',
  'meet.notify.noneSent': 'Meeting saved. No attendee has an email address, so no mail was sent.',
  'meet.notify.failed': 'The meeting was saved, but sending the email failed — {error}',
  'meet.notify.unknown': 'The meeting was saved, but the send result could not be confirmed.',
  'meet.notify.reason.no_email': 'no email',
  'meet.notify.reason.invalid_email': 'invalid email format',
  'meet.notify.reason.rejected': 'rejected by mail server',
```

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음. ko/en 키가 어긋나면 `meetingsEn` 선언에서 에러가 난다.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/i18n/dict/meetings.ts
git commit -m "feat(meetings): 회의 안내 메일 문구 ko/en 추가"
```

---

## Task 5: `describeNotifyResult` — 결과 해석

발송 결과를 "화면에 어떻게 보여줄지"로 바꾸는 순수 함수.
UI 테스트 없이 표시 규칙을 검증하기 위해 모달에서 분리한다.

**이 파일이 `MeetingNotifyResult` 타입을 소유한다.** 액션(Task 7)이 여기서 import 한다.
반대 방향이면 순수 모듈이 `'use server'` 파일에 의존하게 된다.

**Files:**
- Create: `src/lib/mail/outcome.ts`
- Test: `tests/mail/outcome.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/mail/outcome.test.ts
import { describe, it, expect } from 'vitest'
import type { DictKey } from '@/lib/i18n/dict'
import { DICT } from '@/lib/i18n/dict'
import { describeNotifyResult, type MeetingNotifyResult } from '@/lib/mail/outcome'

// 실제 ko 사전을 그대로 쓴다 — 키 오타가 테스트에서 잡힌다.
const t = (k: DictKey) => (DICT.ko as Record<string, string>)[k] ?? k

function res(over: Partial<MeetingNotifyResult> = {}): MeetingNotifyResult {
  return { ok: true, sentTo: [], skipped: [], ...over }
}

describe('describeNotifyResult', () => {
  it('전원 발송이면 토스트로 알린다', () => {
    const out = describeNotifyResult(res({ sentTo: ['김철수', '박영희'] }), t)
    expect(out.kind).toBe('toast')
    expect(out.message).toBe('참석자 2명에게 회의 안내 메일을 보냈습니다.')
  })

  it('일부 제외가 있으면 패널을 띄우고 이름과 사유를 적는다', () => {
    const out = describeNotifyResult(res({
      sentTo: ['김철수'],
      skipped: [{ name: '박영희', reason: 'no_email' }, { name: '이민수', reason: 'invalid_email' }],
    }), t)
    expect(out.kind).toBe('panel')
    expect(out).toMatchObject({ tone: 'warn' })
    expect(out.message).toContain('1명에게 발송했고')
    expect(out.message).toContain('박영희(이메일 없음)')
    expect(out.message).toContain('이민수(이메일 형식 오류)')
  })

  it('보낼 주소가 하나도 없으면 전용 문구를 쓴다', () => {
    const out = describeNotifyResult(res({
      sentTo: [], skipped: [{ name: '박영희', reason: 'no_email' }],
    }), t)
    expect(out.kind).toBe('panel')
    expect(out.message).toBe('회의가 저장되었습니다. 이메일이 있는 참석자가 없어 메일을 보내지 않았습니다.')
  })

  it('발송 실패는 error 톤 패널이며 사유를 그대로 싣는다', () => {
    const out = describeNotifyResult(res({ ok: false, error: '메일 계정 인증에 실패했습니다.' }), t)
    expect(out).toMatchObject({ kind: 'panel', tone: 'error' })
    expect(out.message).toBe('회의는 정상 저장되었습니다. 다만 메일 발송에 실패했습니다 — 메일 계정 인증에 실패했습니다.')
  })

  it('실패인데 사유가 없으면 결과 미확인 문구로 폴백한다', () => {
    const out = describeNotifyResult(res({ ok: false }), t)
    expect(out).toMatchObject({ kind: 'panel', tone: 'error' })
    expect(out.message).toBe('회의는 저장되었으나 발송 결과를 확인하지 못했습니다.')
  })

  it('rejected 사유도 사람이 읽는 말로 바꾼다', () => {
    const out = describeNotifyResult(res({
      sentTo: ['김철수'], skipped: [{ name: '박영희', reason: 'rejected' }],
    }), t)
    expect(out.message).toContain('박영희(수신 거부됨)')
  })

  it('사전에 없는 키로 새지 않는다 — 모든 문구가 원문 키와 달라야 한다', () => {
    const out = describeNotifyResult(res({ sentTo: ['김철수'] }), t)
    expect(out.message).not.toContain('meet.notify')
    expect(out.message).not.toContain('{')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/mail/outcome.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/mail/outcome"`

- [ ] **Step 3: 구현**

```ts
// src/lib/mail/outcome.ts
import type { DictKey } from '@/lib/i18n/dict'
import type { SkipReason } from '@/lib/mail/recipients'

export interface MeetingNotifyResult {
  ok: boolean
  /** 전송 자체가 불가능했던 사유(사용자에게 그대로 보여줄 수 있는 한국어 문장). */
  error?: string
  /** 메일이 나간 참석자 이름. */
  sentTo: string[]
  /** 제외된 참석자와 이유. */
  skipped: { name: string; reason: SkipReason }[]
}

export type NotifyOutcome =
  /** 전원 성공 — 모달을 닫고 토스트만 띄운다. */
  | { kind: 'toast'; message: string }
  /** 사용자가 읽고 넘겨야 하는 결과 — 모달을 붙잡아 둔다. */
  | { kind: 'panel'; tone: 'warn' | 'error'; message: string }

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

type T = (key: DictKey) => string

/**
 * 발송 결과 → 화면 표시 방식.
 * 토스트는 3.5초 뒤 사라지므로 성공에만 쓰고, 나쁜 소식은 패널로 남긴다.
 */
export function describeNotifyResult(res: MeetingNotifyResult, t: T): NotifyOutcome {
  if (!res.ok) {
    return {
      kind: 'panel',
      tone: 'error',
      message: res.error
        ? fill(t('meet.notify.failed'), { error: res.error })
        : t('meet.notify.unknown'),
    }
  }

  if (res.sentTo.length === 0) {
    return { kind: 'panel', tone: 'warn', message: t('meet.notify.noneSent') }
  }

  if (res.skipped.length === 0) {
    return { kind: 'toast', message: fill(t('meet.notify.sent'), { n: String(res.sentTo.length) }) }
  }

  const names = res.skipped
    .map(s => `${s.name}(${t(`meet.notify.reason.${s.reason}` as DictKey)})`)
    .join(', ')
  return {
    kind: 'panel',
    tone: 'warn',
    message: fill(t('meet.notify.partial'), { n: String(res.sentTo.length), names }),
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/mail/outcome.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/mail/outcome.ts tests/mail/outcome.test.ts
git commit -m "feat(mail): 발송 결과 해석 — 성공은 토스트, 나쁜 소식은 패널"
```

---

## Task 6: `transport.ts` — SMTP 트랜스포트

이 파일이 **유일한 부작용 지점**이다. 나중에 사내 SMTP나 Resend로 갈아탈 때 여기만 바꾼다.

`vitest.config.ts`가 `server-only`를 `node_modules/server-only/empty.js`로 aliasing 하므로
테스트에서 import 해도 throw 하지 않는다.

**Files:**
- Create: `src/lib/mail/transport.ts`
- Test: `tests/mail/transport.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/mail/transport.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn()
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))

import { getTransport } from '@/lib/mail/transport'

describe('getTransport', () => {
  beforeEach(() => { createTransport.mockClear(); sendMail.mockReset() })
  afterEach(() => { vi.unstubAllEnvs() })

  it('SMTP_USER 가 없으면 throw 하지 않고 ok:false 를 낸다', () => {
    vi.stubEnv('SMTP_USER', '')
    vi.stubEnv('SMTP_PASS', 'pw')
    const tx = getTransport()
    expect(tx.ok).toBe(false)
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('SMTP_PASS 가 없어도 ok:false 를 낸다', () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', '')
    expect(getTransport().ok).toBe(false)
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('둘 다 있으면 Gmail SMTP 를 465/secure + 10초 타임아웃으로 만든다', () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', 'pw')
    expect(getTransport().ok).toBe(true)
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: 'a@gmail.com', pass: 'pw' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }))
  })

  it('send 는 발신 표시명을 붙이고 rejected 를 문자열 배열로 돌려준다', async () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', 'pw')
    vi.stubEnv('MAIL_FROM_NAME', '테스트 발신')
    sendMail.mockResolvedValue({ rejected: ['bad@x.com'] })

    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    const out = await tx.send({
      to: ['a@dongkuk.com'], replyTo: 'me@dongkuk.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    })

    expect(out).toEqual({ rejected: ['bad@x.com'] })
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: '테스트 발신', address: 'a@gmail.com' },
      to: ['a@dongkuk.com'], replyTo: 'me@dongkuk.com',
      subject: 'S', html: '<b>H</b>', text: 'T',
    }))
  })

  it('rejected 가 없으면 빈 배열을 낸다', async () => {
    vi.stubEnv('SMTP_USER', 'a@gmail.com')
    vi.stubEnv('SMTP_PASS', 'pw')
    sendMail.mockResolvedValue({})
    const tx = getTransport()
    if (!tx.ok) throw new Error('트랜스포트가 만들어져야 한다')
    expect(await tx.send({ to: ['a@b.com'], replyTo: null, subject: 'S', html: 'H', text: 'T' }))
      .toEqual({ rejected: [] })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/mail/transport.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/mail/transport"`

- [ ] **Step 3: 구현**

```ts
// src/lib/mail/transport.ts
import 'server-only'
import nodemailer from 'nodemailer'

export interface MailMessage {
  to: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
}

export type Transport =
  | { ok: true; send: (msg: MailMessage) => Promise<{ rejected: string[] }> }
  | { ok: false; error: string }

// nodemailer 기본 타임아웃은 훨씬 길다. 사용자가 저장 버튼 앞에서 기다리는 동기 경로이므로 짧게 묶는다.
const TIMEOUT_MS = 10_000
const DEFAULT_FROM_NAME = 'D-CUBE 회의알림'

/**
 * Gmail SMTP 트랜스포트.
 * 환경변수가 없으면 **throw 하지 않고** ok:false 를 낸다 — 로컬·Preview 에서 화면을 죽이지 않기 위해서다.
 * `from` 은 이 모듈이 소유한다. 호출자가 발신 주소를 바꿀 수 없다.
 */
export function getTransport(): Transport {
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  if (!user || !pass) return { ok: false, error: '메일 발송이 설정되지 않았습니다.' }

  const fromName = process.env.MAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME
  const tx = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })

  return {
    ok: true,
    send: async (msg) => {
      const info = await tx.sendMail({
        from: { name: fromName, address: user },
        to: msg.to,
        replyTo: msg.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      })
      // nodemailer 의 rejected 는 문자열 또는 주소 객체가 섞여 올 수 있다.
      const rejected = (info.rejected ?? []) as unknown[]
      return {
        rejected: rejected.map(r =>
          typeof r === 'string' ? r : String((r as { address?: string })?.address ?? r)),
      }
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/mail/transport.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/mail/transport.ts tests/mail/transport.test.ts
git commit -m "feat(mail): Gmail SMTP 트랜스포트 — 미설정 시 throw 대신 ok:false"
```

---

## Task 7: `notifyMeetingCreated` 서버 액션

부품을 엮는다. **권한 게이트가 이 기능의 유일한 남용 차단선이다** — 없으면 임의의 회의 ID로
메일을 반복 발송하는 통로가 열린다. 게이트 통과 전에는 트랜스포트를 만들지 않는다.

인자가 `meetingId` 하나뿐인 것은 의도적이다. 클라이언트가 수신자 목록을 넘기지 않으므로
조작된 요청으로 임의 주소에 메일을 보낼 수 없다.

**Files:**
- Create: `src/app/actions/meetingNotify.ts`
- Test: `tests/actions/meeting-notify-gate.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/actions/meeting-notify-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트를 통과하기 전에는 트랜스포트를 만들면 안 된다.
const { getTransport, send } = vi.hoisted(() => {
  const send = vi.fn()
  return { send, getTransport: vi.fn(() => ({ ok: true, send })) }
})
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getMeetingDetail: vi.fn() }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))

import { getMembership, getSession } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/data/meetings'
import { notifyMeetingCreated } from '@/app/actions/meetingNotify'

const USER = { id: 'u1', email: 'me@dongkuk.com', user_metadata: { full_name: '김철수' } }

const MEETING = {
  id: 'm1', projectId: 'p1', title: '주간 점검', meetingDate: '2026-07-25',
  startTime: '14:00', endTime: '15:00', location: null, category: 'routine' as const,
  body: '', recurrence: 'none' as const, recurrenceUntil: null,
  createdBy: 'u1', createdByName: '김철수',
  createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z', attendeeIds: [],
}

function detail(attendees: { id: string; name: string; email: string | null }[], createdBy = 'u1') {
  return {
    meeting: { ...MEETING, createdBy },
    attendees: attendees.map(a => ({ ...a, teamCode: null })),
  }
}

describe('notifyMeetingCreated 권한 게이트', () => {
  beforeEach(() => {
    getTransport.mockClear(); send.mockReset()
    // getMeetingDetail 은 '호출되지 않았다' 를 단언하므로 매 테스트 초기화한다.
    vi.mocked(getMeetingDetail).mockClear()
    vi.mocked(getSession).mockResolvedValue(USER as never)
    vi.mocked(getMembership).mockResolvedValue({ role: 'team_editor' } as never)
  })

  it('로그인하지 않으면 거부하고 회의를 조회하지도 않는다', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    vi.mocked(getMembership).mockResolvedValue(null as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '로그인 필요' })
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('없는 회의는 거부한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(null as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '회의를 찾을 수 없습니다.' })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('작성자도 pmo_admin 도 아니면 거부하고 트랜스포트를 만들지 않는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(getTransport).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('pmo_admin 은 남의 회의도 보낼 수 있다', async () => {
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin' } as never)
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
  })
})

describe('notifyMeetingCreated 발송', () => {
  beforeEach(() => {
    getTransport.mockClear(); send.mockReset()
    vi.mocked(getSession).mockResolvedValue(USER as never)
    vi.mocked(getMembership).mockResolvedValue({ role: 'team_editor' } as never)
  })

  it('유효 주소가 없으면 전송을 시도하지 않고 ok:true 로 전원 제외를 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: null }]) as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toEqual({ ok: true, sentTo: [], skipped: [{ name: '박영희', reason: 'no_email' }] })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('Reply-To 를 호출자 이메일로 지정하고 유효 주소만 To 에 넣는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(detail([
      { id: 'a1', name: '박영희', email: 'y@dongkuk.com' },
      { id: 'a2', name: '이민수', email: 'broken-email' },
    ]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingCreated('m1')

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['y@dongkuk.com'], replyTo: 'me@dongkuk.com',
    }))
    expect(res.sentTo).toEqual(['박영희'])
    expect(res.skipped).toEqual([{ name: '이민수', reason: 'invalid_email' }])
  })

  it('SMTP 가 거절한 주소를 rejected 로 합쳐 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(detail([
      { id: 'a1', name: '박영희', email: 'y@dongkuk.com' },
      { id: 'a2', name: '최지훈', email: 'j@dongkuk.com' },
    ]) as never)
    send.mockResolvedValue({ rejected: ['J@dongkuk.com'] })

    const res = await notifyMeetingCreated('m1')

    expect(res.sentTo).toEqual(['박영희'])
    expect(res.skipped).toEqual([{ name: '최지훈', reason: 'rejected' }])
  })

  it('트랜스포트 미설정이면 그 사유를 그대로 올린다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    getTransport.mockReturnValueOnce({ ok: false, error: '메일 발송이 설정되지 않았습니다.' } as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '메일 발송이 설정되지 않았습니다.' })
  })

  it('EAUTH 는 자격증명을 노출하지 않는 문구로 바꾼다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockRejectedValue(Object.assign(new Error('535-5.7.8 Username and Password not accepted'), { code: 'EAUTH' }))
    const res = await notifyMeetingCreated('m1')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.')
    expect(res.error).not.toContain('Password')
  })

  it('타임아웃은 연결 실패 문구로 바꾼다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const res = await notifyMeetingCreated('m1')
    expect(res.error).toBe('메일 서버에 연결하지 못했습니다.')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/meeting-notify-gate.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/actions/meetingNotify"`

- [ ] **Step 3: 구현**

```ts
// src/app/actions/meetingNotify.ts
'use server'
import { getMembership, getSession } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/data/meetings'
import { classifyRecipients } from '@/lib/mail/recipients'
import { renderMeetingInvite } from '@/lib/mail/meetingInvite'
import { getTransport } from '@/lib/mail/transport'
import { displayNameFrom } from '@/lib/domain/display-name'
import type { MeetingNotifyResult } from '@/lib/mail/outcome'

const NONE = { sentTo: [] as string[], skipped: [] as MeetingNotifyResult['skipped'] }

/** 메일 본문 링크의 절대 주소. 없으면 링크를 생략한다(상대경로 링크는 메일에서 무의미하다). */
function resolveAppUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return vercel ? `https://${vercel}` : null
}

/** SMTP 원문 에러에는 계정·호스트 정보가 섞인다. 사용자에게는 사유만 전한다. */
function toUserMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  if (code === 'EAUTH') return '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return '메일 서버에 연결하지 못했습니다.'
  }
  return '메일 발송 중 오류가 발생했습니다.'
}

/**
 * 회의 참석자에게 안내 메일을 보낸다.
 * createMeeting 이 커밋된 뒤에 호출되므로, 여기서 무엇이 실패하든 회의 데이터는 남는다.
 * 인자가 meetingId 뿐인 것은 의도적이다 — 수신자는 서버가 DB 에서 다시 읽는다.
 */
export async function notifyMeetingCreated(meetingId: string): Promise<MeetingNotifyResult> {
  const [membership, user] = await Promise.all([getMembership(), getSession()])
  if (!membership || !user) return { ok: false, error: '로그인 필요', ...NONE }

  const detail = await getMeetingDetail(meetingId)
  if (!detail) return { ok: false, error: '회의를 찾을 수 없습니다.', ...NONE }
  const { meeting, attendees } = detail

  // 남의 회의 ID 로 메일을 반복 발송하는 통로를 막는 유일한 지점.
  const isOwner = meeting.createdBy === user.id
  if (!isOwner && membership.role !== 'pmo_admin') return { ok: false, error: '권한 없음', ...NONE }

  const { valid, skipped } = classifyRecipients(attendees)
  // 빈 To 로 SMTP 를 때리면 계정 평판만 깎인다.
  if (valid.length === 0) return { ok: true, sentTo: [], skipped }

  const transport = getTransport()
  if (!transport.ok) return { ok: false, error: transport.error, sentTo: [], skipped }

  const { subject, html, text } = renderMeetingInvite({
    meeting,
    attendeeNames: attendees.map(a => a.name),
    senderName: meeting.createdByName ?? displayNameFrom(user.user_metadata, user.email),
    appUrl: resolveAppUrl(),
  })

  try {
    // Reply-To 는 호출자다. 회의 작성자의 이메일은 auth.users 에 있어 anon 클라이언트로 읽을 수 없고,
    // 사실상 작성 직후 본인이 호출한다(pmo_admin 대행은 예외적 경로).
    const { rejected } = await transport.send({
      to: valid.map(v => v.email),
      replyTo: user.email ?? null,
      subject, html, text,
    })

    const rejectedSet = new Set(rejected.map(r => r.trim().toLowerCase()))
    return {
      ok: true,
      sentTo: valid.filter(v => !rejectedSet.has(v.email)).map(v => v.name),
      skipped: [
        ...skipped,
        ...valid.filter(v => rejectedSet.has(v.email))
          .map(v => ({ name: v.name, reason: 'rejected' as const })),
      ],
    }
  } catch (e) {
    console.error('[notifyMeetingCreated] 발송 실패:', e)
    return { ok: false, error: toUserMessage(e), sentTo: [], skipped }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions/meeting-notify-gate.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/meetingNotify.ts tests/actions/meeting-notify-gate.test.ts
git commit -m "feat(meetings): 회의 안내 메일 발송 액션 — 작성자·pmo_admin 게이트"
```

---

## Task 8: `MeetingFormModal` — 체크박스·결과 패널·폼 잠금

표시 규칙은 이미 `describeNotifyResult`로 검증했으므로(Task 5) 여기서는 **배선만** 한다.
이 프로젝트의 UI 테스트는 testing-library 없이 `react-dom/client` + `act`로 직접 쓴다.
모달 하나를 띄우려면 LocaleProvider·ToastProvider·포털·서버 액션을 전부 모킹해야 하고,
그렇게 얻는 확신은 `outcome.test.ts`가 이미 준 것과 같다. **UI 테스트는 만들지 않는다.**

**가장 중요한 것은 폼 잠금이다.** 결과 패널 때문에 모달이 열린 채 남으면 사용자가 저장을
다시 눌러 **같은 회의를 하나 더 만든다.**

**Files:**
- Modify: `src/components/meetings/MeetingFormModal.tsx`

- [ ] **Step 1: import 와 FormState 확장**

`MeetingFormModal.tsx:1-17`의 import 블록과 타입을 아래로 교체한다.

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { DictKey } from '@/lib/i18n/dict'
import type { Meeting, MeetingCategory, MeetingRecurrence, ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { MEETING_CATEGORIES, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { MeetingAttendeePicker } from './MeetingAttendeePicker'
import { createMeeting, updateMeeting, type MeetingInput } from '@/app/actions/meetings'
import { notifyMeetingCreated } from '@/app/actions/meetingNotify'
import { describeNotifyResult, type NotifyOutcome } from '@/lib/mail/outcome'

type FormState = {
  title: string; meetingDate: string; allDay: boolean; startTime: string; endTime: string
  location: string; category: MeetingCategory; recurrence: MeetingRecurrence
  recurrenceUntil: string; body: string; attendeeIds: string[]; notify: boolean
}
```

- [ ] **Step 2: `initState` 에 `notify` 기본값 추가**

`initState` 의 두 return 문에 `notify` 를 넣는다. 수정 모드에서는 발송하지 않으므로 `false`.

```tsx
function initState(initial: Meeting | null, todayIso: string): FormState {
  if (!initial) return {
    title: '', meetingDate: todayIso, allDay: false, startTime: '10:00', endTime: '11:00',
    location: '', category: 'routine', recurrence: 'none', recurrenceUntil: '', body: '',
    attendeeIds: [], notify: true,
  }
  return {
    title: initial.title,
    meetingDate: initial.meetingDate,
    allDay: initial.startTime === null,
    startTime: initial.startTime ?? '10:00',
    endTime: initial.endTime ?? '',
    location: initial.location ?? '',
    category: initial.category,
    recurrence: initial.recurrence,
    recurrenceUntil: initial.recurrenceUntil ?? '',
    body: initial.body,
    attendeeIds: initial.attendeeIds,
    notify: false,
  }
}
```

- [ ] **Step 3: 상태와 submit 교체**

`const { t } = useLocale()` 부터 `submit()` 함수 끝까지(`MeetingFormModal.tsx:50-78`)를 교체한다.

```tsx
  const { t } = useLocale()
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(() => initState(initial, todayIso))
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // 결과 패널이 떠 있는 동안 회의는 이미 저장된 상태다. 폼을 잠가 중복 생성을 막는다.
  const [outcome, setOutcome] = useState<NotifyOutcome | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (open) { setForm(initState(initial, todayIso)); setErr(null); setOutcome(null); setSending(false) }
  }, [open, initial, todayIso])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const locked = outcome !== null
  const busy = pending || sending
  const canNotify = !initial && form.attendeeIds.length > 0

  function submit() {
    const input: MeetingInput = {
      title: form.title,
      meetingDate: form.meetingDate,
      startTime: form.allDay ? null : form.startTime,
      endTime: form.allDay || !form.endTime ? null : form.endTime,
      location: form.location.trim() || null,
      category: form.category,
      body: form.body,
      recurrence: form.recurrence,
      recurrenceUntil: form.recurrence === 'none' ? null : (form.recurrenceUntil || null),
      attendeeIds: form.attendeeIds,
    }
    setErr(null)
    startTransition(async () => {
      const res = initial ? await updateMeeting(initial.id, input) : await createMeeting(projectId, input)
      if (!res.ok) { setErr(res.error ?? t('meet.saveFailed')); return }

      // 여기부터 회의는 이미 커밋됐다. 어떤 실패도 저장을 되돌리지 않는다.
      if (!canNotify || !form.notify || !res.id) { onSaved(); return }

      setSending(true)
      try {
        const sent = await notifyMeetingCreated(res.id)
        const next = describeNotifyResult(sent, t)
        if (next.kind === 'toast') {
          toast({ title: t('meet.notify.toastTitle'), description: next.message, variant: 'success' })
          onSaved()
          return
        }
        setOutcome(next)
      } catch {
        // 액션 호출 자체가 실패한 경우 — 회의가 사라진 게 아님을 반드시 알린다.
        setOutcome({ kind: 'panel', tone: 'error', message: t('meet.notify.unknown') })
      } finally {
        setSending(false)
      }
    })
  }
```

- [ ] **Step 4: 푸터 교체**

`Modal` 의 `footer` prop(`MeetingFormModal.tsx:86-91`)을 교체한다. 결과 패널이 뜨면 버튼은 `닫기` 하나뿐이다.

```tsx
      footer={
        locked ? (
          <button onClick={onSaved} className="btn btn-primary">{t('common.close')}</button>
        ) : (
          <>
            <button onClick={onClose} disabled={busy} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={submit} disabled={busy} className="btn btn-primary">
              {sending ? t('meet.notify.sending') : pending ? t('meet.saving') : t('common.save')}
            </button>
          </>
        )
      }
```

- [ ] **Step 5: 폼 잠금 래퍼 추가**

본문 최상위 `<div className="space-y-4">` 를 `<fieldset>` 으로 감싼다. `disabled` 하나로
내부 input/select/textarea/button 이 전부 잠긴다.

```tsx
      <fieldset disabled={locked} className="min-w-0 border-0 p-0 disabled:opacity-60">
        <div className="space-y-4">
          {/* 기존 폼 내용 그대로 */}
        </div>
      </fieldset>
```

- [ ] **Step 6: 체크박스 추가**

참석자 피커 블록(`meet.form.attendees`) 바로 다음, 메모(`meet.form.body`) 앞에 삽입한다.
**신규 생성일 때만 렌더한다.**

```tsx
        {!initial && (
          <div>
            <label className="flex items-center gap-2">
              <input
                id="notify-attendees"
                type="checkbox"
                checked={form.notify && canNotify}
                disabled={!canNotify}
                onChange={e => set('notify', e.target.checked)}
                className="h-4 w-4 accent-[var(--color-brand)] disabled:opacity-50"
              />
              <span className="text-xs font-semibold text-ink-muted">{t('meet.form.notify')}</span>
            </label>
            {!canNotify && (
              <p className="mt-1 pl-6 text-[11px] text-ink-subtle">{t('meet.form.notifyNoAttendees')}</p>
            )}
          </div>
        )}
```

- [ ] **Step 7: 결과 패널 추가**

기존 에러 문단(`{err && (...)}`) 바로 다음에 삽입한다. `fieldset` **바깥**이어야
잠금 상태에서도 읽을 수 있다 — `fieldset` 을 닫은 뒤 배치한다.

```tsx
      {outcome?.kind === 'panel' && (
        <p className={`mt-4 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${
          outcome.tone === 'error' ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'
        }`}>
          {outcome.tone === 'error'
            ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {outcome.message}
        </p>
      )}
```

- [ ] **Step 8: 타입·린트 확인**

Run: `npx tsc --noEmit && npx eslint src/components/meetings/MeetingFormModal.tsx`
Expected: 에러 없음

경고 톤은 `bg-pending-weak text-accent-warning` 조합을 쓴다 —
`HeaderChrome.tsx:171`·`KpiCard.tsx:10` 과 같은 짝이다.
`text-pending` 은 다크모드에서 회색(`--color-pending: #b6aa9e`)이라 경고로 읽히지 않는다.

- [ ] **Step 9: 커밋**

```bash
git add src/components/meetings/MeetingFormModal.tsx
git commit -m "feat(meetings): 회의 저장 시 참석자 안내 메일 발송 — 체크박스·결과 패널·중복 생성 방지"
```

---

## Task 9: 전체 검증

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 기존 테스트 전부 PASS + 신규 4개 파일 PASS. 실패가 하나라도 있으면 다음 단계로 넘어가지 않는다.

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 에러 없음

- [ ] **Step 4: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공.

`server-only` 위반이 있으면 여기서 잡힌다 — `transport.ts` 가 클라이언트 번들로 끌려가면
빌드가 실패한다. 실패한다면 `MeetingFormModal` 이 `transport` 를 직접 import 하고 있지 않은지
확인한다(모달은 액션과 `outcome` 만 import 해야 한다).

- [ ] **Step 5: 커밋 (수정이 있었을 때만)**

```bash
git add -A
git commit -m "fix(mail): 전체 검증에서 드러난 문제 수정"
```

---

## Task 10: 실환경 검증과 배포

**여기가 이 기능의 진짜 시험대다.** 코드가 다 돌아도 메일이 스팸함으로 가면 무용지물이다.

- [ ] **Step 1: Gmail 앱 비밀번호 발급**

Google 계정 → 보안 → 2단계 인증(켜져 있어야 함) → 앱 비밀번호 → 16자리 발급.
계정 비밀번호로는 SMTP 인증이 되지 않는다.

- [ ] **Step 2: 로컬 `.env.local` 설정**

```bash
SMTP_USER=<gmail 주소>
SMTP_PASS=<16자리 앱 비밀번호, 공백 제거>
MAIL_FROM_NAME=D-CUBE 회의알림
NEXT_PUBLIC_APP_URL=https://wbs-web.vercel.app
```

- [ ] **Step 3: 로컬 실발송 1회**

Run: `npm run dev`

1. 회의일정 → 새 회의
2. 참석자에 **본인 회사 주소(@dongkuk)** 가 등록된 멤버를 선택
3. 체크박스가 켜진 상태로 저장
4. 토스트가 뜨는지 확인

- [ ] **Step 4: 받은 메일 육안 확인 — 체크리스트**

- [ ] **받은편지함에 도착했는가, 스팸함으로 갔는가** ← 가장 중요
- [ ] 발신인이 `D-CUBE 회의알림` 으로 보이는가
- [ ] 회신 버튼을 눌렀을 때 회신 주소가 본인(작성자)인가
- [ ] 제목에 날짜·요일·시각이 정확한가 (요일이 하루 밀리지 않았는가)
- [ ] 본문 표가 깨지지 않는가, 링크가 실제 회의일정으로 가는가
- [ ] 원문 보기에서 text 파트가 함께 들어 있는가

- [ ] **Step 5: 제외 경로 확인**

이메일이 없는 멤버를 함께 선택해 저장한다.
Expected: 모달이 닫히지 않고 `회의가 저장되었습니다. 1명에게 발송했고, 다음 참석자는 제외했습니다 — OOO(이메일 없음)` 패널이 뜬다. 저장 버튼이 `닫기` 하나로 바뀌어 다시 누를 수 없다.

- [ ] **Step 6: 미설정 경로 확인**

`.env.local` 에서 `SMTP_PASS` 를 비우고 서버를 재시작해 회의를 저장한다.
Expected: 화면이 죽지 않고 `회의는 정상 저장되었습니다. 다만 메일 발송에 실패했습니다 — 메일 발송이 설정되지 않았습니다.` 패널. **회의는 목록에 정상 등록되어 있어야 한다.**

- [ ] **Step 7: Vercel Production 환경변수 등록**

```bash
vercel env add SMTP_USER production
vercel env add SMTP_PASS production
vercel env add MAIL_FROM_NAME production
vercel env add NEXT_PUBLIC_APP_URL production
```

Preview 에는 넣지 않는다 — Step 6 의 경로로 우아하게 실패한다.

- [ ] **Step 8: 배포**

Run: `/deploy` (프로젝트 스킬) 또는 `git push origin main`

- [ ] **Step 9: 프로덕션 실발송 1회**

배포된 앱에서 Step 3~4 를 다시 한다. 로컬은 되는데 프로덕션에서 실패하는 경우가 있다
(환경변수 오타, 서울 리전에서의 Gmail 접속). **실제로 확인하기 전까지 완료로 보고하지 않는다.**

- [ ] **Step 10: 스팸함으로 갔다면**

기능을 되돌리지 말고 발신 경로만 교체한다. `src/lib/mail/transport.ts` 한 파일이다.
사내 SMTP 릴레이 또는 도메인 인증된 외부 API(Resend)로 바꾸고 Task 6 의 테스트를 갱신한다.
나머지 코드는 그대로다 — 어댑터로 격리한 이유가 이것이다.

---

## 완료 조건

1. `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` 전부 통과
2. 프로덕션에서 실제 회의를 만들어 참석자가 **받은편지함에서** 메일을 확인
3. 이메일 없는 참석자를 섞었을 때 제외 사유가 화면에 정확히 표시
4. `SMTP_PASS` 를 지운 상태에서도 회의 저장이 정상 동작

## 하지 않는 것

수정·취소 알림 / 리마인더 + 크론 / `.ics` 초대 / 발송 이력 테이블 / 재발송 버튼 /
수신거부 설정 / 개별·BCC 발송 / 영문 메일 본문 / DB 마이그레이션.
