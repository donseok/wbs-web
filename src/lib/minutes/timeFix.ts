/**
 * 회의록 본문(body_md) 시간대 보정.
 *
 * 배경: 외부 AI 전사(녹취) 도구가 회의록 markdown을 생성할 때 녹음 타임스탬프를
 * KST가 아니라 UTC(−9h)로 기록한다(2026-07 확인). 예: 실제 09:01 회의가 `00:01`로 표기.
 * 이 도구 산출물을 업로드 시 자동으로 +9h 보정한다.
 *
 * 판별(서명 감지): 도구 산출물은 아래 4-마커 메타 헤더 블록을 가진다.
 *   - **날짜**: … / - **시간**: … / - **상태**: … / - **생성자**: …
 * 네 마커가 모두 있을 때만 녹취툴 산출물로 보고 `**시간**:` 한 줄만 +9h 보정한다.
 * 손으로 쓴 md(이 서명 없음)는 절대 건드리지 않아 이미 올바른 시각의 과보정을 막는다.
 *
 * 알려진 한계: 외부 도구가 나중에 KST로 고쳐지면 이 훅이 되레 과보정하게 된다.
 * 그 경우 호출부(createMinute/replaceMinuteBody)에서 이 함수 적용을 제거하면 된다.
 */

export const TZ_OFFSET_HOURS = 9

/** `- **시간**: HH:MM ~ HH:MM` 한 줄. 캡처: 1=접두, 2=시작, 3=중간, 4=종료, 5=꼬리. */
const TIME_LINE_RE = /^(\s*[-*]\s*\*\*시간\*\*:\s*)(\d{2}:\d{2})(\s*~\s*)(\d{2}:\d{2})(\s*)$/m

/** 녹취툴 메타 헤더 서명 — 네 마커가 모두 있어야 산출물로 판정. */
const SIGNATURE_MARKERS = ['**날짜**:', '**시간**:', '**상태**:', '**생성자**:'] as const

function shiftTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const nh = (((h + TZ_OFFSET_HOURS) % 24) + 24) % 24
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export interface MinuteTimeFix {
  body: string
  corrected: boolean
  /** 보정된 경우 원래 시간 문자열 'HH:MM ~ HH:MM'. */
  from?: string
  /** 보정된 경우 보정 후 시간 문자열 'HH:MM ~ HH:MM'. */
  to?: string
}

/** 녹취툴 산출물이면 `**시간**:` 줄을 +9h 보정. 그 외에는 원본 그대로. */
export function correctMinuteBodyTime(bodyMd: string): MinuteTimeFix {
  const body = bodyMd ?? ''
  const hasSignature = SIGNATURE_MARKERS.every(mk => body.includes(mk))
  if (!hasSignature) return { body, corrected: false }

  const match = body.match(TIME_LINE_RE)
  if (!match) return { body, corrected: false }

  const [, prefix, start, mid, end, tail] = match
  const from = `${start} ~ ${end}`
  const to = `${shiftTime(start)} ~ ${shiftTime(end)}`
  const next = body.replace(TIME_LINE_RE, `${prefix}${shiftTime(start)}${mid}${shiftTime(end)}${tail}`)
  return { body: next, corrected: true, from, to }
}
