// 오피스 콘솔(2026-10-06) — 좌석표에서 팀장·팀원 세션에 프롬프트를 보내고 최근 화면(끝 40줄)을 본다. IO 없는 순수 규칙.
// 입력 정리는 서버 액션이 최종 판정하고, 화면은 같은 함수로 미리 안내만 한다(로컬 안전 입력이 거절할 글을 보내지 않게).
// 대기열·전달은 kit 레인의 로컬 폴러가 맡는다 — 계약은 dmes-standard api-contract §2.12.

/** 보낼 대상의 종류 — 조정 세션(팀장·임시 팀원)과 dflow-team 세션(팀장·팀원). */
export type ConsoleTargetKind = 'coord_lead' | 'coord_lane' | 'team_lead' | 'team_worker'

/** 전달 상태 — pending 대기 · claimed 폴러가 집음 · sent 전달됨 · refused 로컬이 거절 · expired 만료 · unknown 집은 뒤 응답 없음. */
export type ConsolePromptStatus = 'pending' | 'claimed' | 'sent' | 'refused' | 'expired' | 'unknown'

export const CONSOLE_TEXT_MAX = 2000
/** 화면 업로드 한도 — 끝 40줄, 8KB. */
export const CONSOLE_SCREEN_LINES = 40

export const CONSOLE_STATUS_LABEL: Record<ConsolePromptStatus, string> = {
  pending: '대기', claimed: '전달 중', sent: '전달', refused: '거절', expired: '만료', unknown: '알 수 없음',
}

/** 공백 하나로 바꾸는 글자 — 줄바꿈(CRLF 는 한 번)·탭·VT·FF·NEL·U+2028·U+2029. 연속 공백은 접지 않는다. */
const BREAKS = /\r\n|[\r\n\t\v\f\u0085\u2028\u2029]/g
/** 지우는 글자 — C0·DEL·C1 제어 문자와, 보이지 않게 글을 뒤집거나 숨기는 서식 문자(양방향 재정의·폭 없는 문자·BOM·태그 문자).
 *  ZWNJ·ZWJ(U+200C·U+200D)는 남긴다 — 이모지 조합과 일부 문자가 깨진다. */
const STRIP = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu

/**
 * 서버가 저장하기 전에 하는 정리(계약 §2.12) — 줄바꿈·탭은 공백으로 먼저 바꾸고(먼저 지우면 단어가 붙는다), 나머지 제어·서식
 * 문자를 지운 뒤 앞뒤 공백을 자른다. 로컬 입력창에는 한 줄로 들어가야 하므로 줄바꿈을 남기지 않는다.
 * 앞머리의 `/`·`@` 는 막지 않는다 — 폴러가 `[오피스→<ref>] 프롬프트: ` 머리글을 붙여 넣으므로 줄이 그 글자로 시작하지 않는다.
 */
export function normalizeConsoleText(raw: string): string {
  return raw.replace(BREAKS, ' ').replace(STRIP, '').trim()
}

/** 글자 수 — 계약은 코드포인트로 센다(이모지 하나 = 1). */
export function consoleTextLength(text: string): number {
  return [...text].length
}

export type ConsoleTextIssue = 'empty' | 'bang' | 'too_long'

/** 정리한 글의 거절 사유. 없으면 null. `!` 는 로컬에서 셸 모드로 바뀌므로 아예 받지 않는다. */
export function consoleTextIssue(normalized: string): ConsoleTextIssue | null {
  if (normalized.length === 0) return 'empty'
  if (normalized.includes('!')) return 'bang'
  if (consoleTextLength(normalized) > CONSOLE_TEXT_MAX) return 'too_long'
  return null
}

export const CONSOLE_ISSUE_TEXT: Record<ConsoleTextIssue, string> = {
  empty: '보낼 글을 적으세요.',
  bang: '느낌표(!)는 보낼 수 없습니다 — 받는 PC 의 안전 입력이 거절합니다.',
  too_long: `${CONSOLE_TEXT_MAX.toLocaleString()}자를 넘으면 보낼 수 없습니다.`,
}
