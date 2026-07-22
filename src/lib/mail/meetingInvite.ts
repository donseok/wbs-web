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
