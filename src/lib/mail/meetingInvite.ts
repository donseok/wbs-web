import { t } from '@/lib/i18n/dict'
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

/** '2026/12/25' */
function fmtDateFull(iso: string): string {
  return `${utcDate(iso).getUTCFullYear()}/${fmtDateShort(iso)}`
}

/**
 * 반복 기간 '7/25~8/29'.
 * 해를 넘기면 연도를 붙인다 — '12/25~1/15' 는 어느 날짜가 어느 해인지 알 수 없다.
 */
function fmtRange(fromIso: string, toIso: string): string {
  const sameYear = utcDate(fromIso).getUTCFullYear() === utcDate(toIso).getUTCFullYear()
  const fmt = sameYear ? fmtDateShort : fmtDateFull
  return `${fmt(fromIso)}~${fmt(toIso)}`
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
  // `as DictKey` 를 붙이지 않는다 — 아래 '구분' 행도 같다.
  // 템플릿 리터럴이 DictKey 에 그대로 assignable 해야, MeetingRecurrence 에 값을 추가하고
  // 사전 항목을 빠뜨렸을 때 컴파일 에러로 잡힌다. 캐스트를 달면 그 에러가 지워지고
  // 대신 'meet.recur.quarterly' 같은 원문 키가 그대로 메일에 실려 외부 수신자에게 나간다.
  // 타입 에러가 나면 캐스트로 덮지 말고 사전에 키를 추가할 것.
  const label = t(LOCALE, `meet.recur.${meeting.recurrence}`)
  const d = utcDate(meeting.meetingDate)
  if (meeting.recurrence === 'weekly' || meeting.recurrence === 'biweekly') {
    return `${label} ${DOW_KR[d.getUTCDay()]}요일`
  }
  if (meeting.recurrence === 'monthly') return `${label} ${d.getUTCDate()}일`
  return label
}

/**
 * 본문 '반복' 행 — 규칙과 기간만. 시각은 붙이지 않는다.
 * whenLabel 을 재사용하면 시작 시각만 담긴 꼬리표가 붙어 바로 위 '일시' 행과 충돌한다
 * ('일시: 7/25(토) 14:00~15:30' / '반복: 매주 토요일 14:00') — 수신자는 2회차부터
 * 종료 시각이 다른지, 첫 회차만 90분인지 알 수 없다. 종일 회의는 '종일'이 두 번 찍힌다.
 */
function recurrenceRow(meeting: Meeting): string {
  const until = meeting.recurrenceUntil
    ? ` (${fmtRange(meeting.meetingDate, meeting.recurrenceUntil)})`
    : ''
  return `${fmtRecurrence(meeting)}${until}`
}

/** 제목 꼬리표 — 단발이면 날짜, 반복이면 규칙과 기간. 제목에는 시각이 있어야 한다. */
function whenLabel(meeting: Meeting): string {
  const time = fmtTimeShort(meeting)
  if (meeting.recurrence === 'none') return `${fmtDateDow(meeting.meetingDate)} ${time}`
  const until = meeting.recurrenceUntil
    ? ` (${fmtRange(meeting.meetingDate, meeting.recurrenceUntil)})`
    : ''
  return `${fmtRecurrence(meeting)} ${time}${until}`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * 이스케이프 후 줄바꿈을 <br> 로. 순서가 중요하다 — esc() 는 줄바꿈을 건드리지 않으므로
 * 이스케이프를 먼저 해야 <br> 자체가 다시 이스케이프되지 않는다.
 * 안건은 textarea 에서 오는 유일한 여러 줄 값이고, white-space:pre-wrap 은
 * Outlook(Word 엔진)·일부 Gmail 경로에서 무시되므로 마크업으로 직접 끊는다.
 */
function escMultiline(s: string): string {
  return esc(s).replace(/\n/g, '<br>')
}

/** 메일 헤더는 한 줄이다 — 제목의 CR/LF 는 헤더 주입 표면이므로 여기서 잘라낸다. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ')
}

type Row = { label: string; value: string }

/**
 * 'Segoe UI' 를 맨 앞에 둔다 — Word 엔진이 아는 이름이어야 한다.
 * -apple-system 이 선두면 Word 가 스택 파싱에 실패해 통째로 무시할 위험이 있다.
 */
const FONT_STACK = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif"

/**
 * Outlook(Word 엔진)은 폰트를 표 셀로 상속시키지 않는다. 래퍼 div 에만 선언하면
 * 모든 <td> 가 Word 기본 명조체(Times New Roman)·기본 크기로 떨어져 본문 전체가 뒤틀린다.
 * 그래서 셀마다 같은 선언을 되풀이한다. 여백을 HTML 속성으로도 못박는 것과 같은 이유다.
 * color 는 여기 넣지 않는다 — 라벨 셀은 회색이라, 한 style 안에 color 가 두 번 들어가는
 * 모호한 선언(뒤가 이긴다는 규칙에 기대는)을 만들지 않기 위함이다.
 */
const BODY_FONT = `font-family:${FONT_STACK};font-size:14px;line-height:1.6`
const INK = '#1f2328'
const INK_MUTED = '#6b7280'

/** 새 회의인지 이미 안내가 나간 회의의 변경인지. 제목 접두사만 가른다. */
export type InviteKind = 'created' | 'updated'

/**
 * 수신자는 제목만 보고 '새 회의'와 '바뀐 회의'를 구분한다.
 * 두 접두사가 같아지면 이미 캘린더에 넣어 둔 회의를 또 잡는 중복 일정이 생긴다.
 */
const SUBJECT_PREFIX: Record<InviteKind, string> = {
  created: '[회의 안내]',
  updated: '[회의 변경]',
}

export function renderMeetingInvite(input: {
  /** 기본값을 두지 않는다 — 빠뜨린 호출자가 조용히 '안내'로 나가는 대신 컴파일에서 걸려야 한다. */
  kind: InviteKind
  meeting: Meeting
  attendeeNames: string[]
  senderName: string
  appUrl: string | null
}): { subject: string; html: string; text: string } {
  const { kind, meeting, attendeeNames, senderName, appUrl } = input

  // 본문은 kind 를 보지 않는다. 변경 메일이라고 문구를 덧붙이면 '무엇이 바뀌었나'를
  // 말하지 않으면서 말하는 척하게 되고, 그 순간 수정 전 값을 읽어 오는 조회가 필요해진다.
  const subject = oneLine(`${SUBJECT_PREFIX[kind]} ${meeting.title} · ${whenLabel(meeting)}`)
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/p/${meeting.projectId}/meetings` : null

  // 값이 빈 항목은 줄 자체를 만들지 않는다 — 빈 항목을 나열하지 않는다.
  const rows: Row[] = [
    { label: '일시', value: `${fmtDateDow(meeting.meetingDate)} ${fmtTime(meeting)}` },
  ]
  if (meeting.recurrence !== 'none') rows.push({ label: '반복', value: recurrenceRow(meeting) })
  if (meeting.location?.trim()) rows.push({ label: '장소', value: meeting.location.trim() })
  rows.push({ label: '구분', value: t(LOCALE, `meet.cat.${meeting.category}`) })
  if (attendeeNames.length) rows.push({ label: '참석자', value: attendeeNames.join(', ') })
  if (senderName.trim()) rows.push({ label: '작성자', value: senderName.trim() })
  if (meeting.body.trim()) rows.push({ label: '안건', value: meeting.body.trim() })

  const text = [
    `${meeting.title}`,
    '',
    ...rows.map(r => `${r.label}: ${r.value}`),
    ...(link ? ['', `회의일정에서 보기: ${link}`] : []),
  ].join('\n')

  const html = [
    `<div style="${BODY_FONT};color:${INK};max-width:560px">`,
    `<h2 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:18px">${esc(meeting.title)}</h2>`,
    // Outlook 은 Word 엔진으로 그려 표의 CSS 를 일부만 따른다 — 여백은 HTML 속성으로도 못박는다.
    // role="presentation" — 라벨/값 2단 레이아웃이지 데이터 표가 아니므로 표로 읽히면 안 된다.
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%">',
    ...rows.map(r =>
      `<tr><td style="${BODY_FONT};color:${INK_MUTED};padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top">${esc(r.label)}</td>` +
      `<td style="${BODY_FONT};color:${INK};padding:6px 0">${escMultiline(r.value)}</td></tr>`),
    '</table>',
    ...(link
      ? [`<p style="margin:20px 0 0"><a href="${esc(link)}" style="color:#2563eb">회의일정에서 보기</a></p>`]
      : []),
    '</div>',
  ].join('')

  return { subject, html, text }
}
