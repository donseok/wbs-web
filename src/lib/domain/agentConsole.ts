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

// ── 대상·로컬 API 검증(계약 §2.12) ────────────────────────────────────────────────────────────────────

export const CONSOLE_TARGET_KINDS: readonly ConsoleTargetKind[] = ['coord_lead', 'coord_lane', 'team_lead', 'team_worker']
/** PC 슬러그 — 좌석 키 가운데 칸. DB 검사(0109)와 같다. */
export const CONSOLE_HOST_RE = /^[a-z0-9-]{1,63}$/
/** 대상 참조 — 같은 owner·host 안에서 대상을 가른다. DB 검사(0109)와 같다. */
export const CONSOLE_REF_RE = /^[A-Za-z0-9._:-]{1,64}$/

export interface ConsoleTarget { kind: ConsoleTargetKind; ref: string; host: string }

/**
 * 좌석 키(<신원>/<host>/<slot>)를 콘솔 대상으로 읽는다. 대상이 아니거나 형식이 계약 밖이면 null(보내지도 보이지도 않는다).
 * - `lead` → team_lead · `w<N>` → team_worker · `coord:<세션8>` → coord_lead(식별자) · `임시:<레인>·<요약>` → coord_lane(레인)
 * - 단독 감시(`poll`)·옛 조정 키 `coord`(식별자 없음)·규칙 밖 신원은 대상이 아니다.
 * agentRoster 의 파서와 같은 규칙을 쓰되 여기서 다시 적는다 — 도메인끼리 순환 import 를 만들지 않으려는 것이다.
 */
export function consoleTargetOfAgent(agent: string | null | undefined): ConsoleTarget | null {
  const parts = (agent ?? '').split('/')
  if (parts.length !== 3 || parts.some(p => p.trim() === '')) return null
  const [, host, slot] = parts
  if (!CONSOLE_HOST_RE.test(host)) return null
  let kind: ConsoleTargetKind
  let ref: string
  if (slot === 'lead') { kind = 'team_lead'; ref = 'lead' }
  else if (/^w\d+$/.test(slot)) { kind = 'team_worker'; ref = slot }
  else if (slot.startsWith('coord:')) { kind = 'coord_lead'; ref = slot.slice('coord:'.length).trim() }
  else if (slot.startsWith('임시:')) {
    const rest = slot.slice('임시:'.length)
    const i = rest.indexOf('·')
    kind = 'coord_lane'; ref = (i < 0 ? rest : rest.slice(0, i)).trim()
  } else return null
  return CONSOLE_REF_RE.test(ref) ? { kind, ref, host } : null
}

/** 대상 열쇠 — 대기열·화면 행의 (host, kind, ref). owner 는 호출자가 따로 맞춘다. */
export function consoleTargetKey(t: Pick<ConsoleTarget, 'kind' | 'ref' | 'host'>): string {
  return `${t.host}\u0000${t.kind}\u0000${t.ref}`
}

export type ConsoleAckResult = 'sent' | 'refused' | 'retry'
export const CONSOLE_ACK_REASONS = ['compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error'] as const

// ── 키 입력(kind:'keys') — 입력 요청(permission·question·choice) 창에 웹이 키로 답한다(계약 lane-summary-contract (C)). ──
/** 허용 키 — 숫자 1~9·Enter·Esc·위/아래 화살표·Tab 만. 서버가 목록 밖을 거절한다. */
export const CONSOLE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Esc', 'Up', 'Down', 'Tab'] as const
export type ConsoleKey = typeof CONSOLE_KEYS[number]
/** 한 번에 보내는 키 수 상한 — 같은 화면 상태(해시)로는 한 번만 보낼 수 있으므로 여러 키는 한 요청에 묶는다. */
export const CONSOLE_KEYS_MAX = 4
/** 웹으로 답할 수 있는 입력 요청 종류 — usage-limit·trust 는 조정자가 자동 처리하고, message 는 터미널 창이 없다. */
export const CONSOLE_ANSWERABLE_KINDS = ['permission', 'question', 'choice'] as const
/** 답하기 요청이 대조할 입력 요청 — 화면이 본 값 그대로(since·kind·발췌 sha). 서버는 저장된 값과 다시 맞춰 본다. */
export interface ConsoleKeysRequest { kind: string; since: string; sha: string }
/** 콘솔 보기가 열람 권한이 있는 사람에게만 주는 입력 요청 — 발췌와 해시 포함. */
export interface ConsoleInputRequestView {
  kind: string; since: string; handled: { by: 'coordinator' | 'auto'; at: string } | null; excerpt: string[]; sha: string
}
export const CONSOLE_SENT_DETAILS = ['turn_started', 'submitted', 'accepted'] as const

/** ack 본문 검사 — 함수(agent_console_ack)와 같은 규칙을 먼저 본다. 문제가 없으면 null, 있으면 사유 문장. */
export function consoleAckIssue(b: { result: unknown; reason?: unknown; detail?: unknown }): string | null {
  if (b.result !== 'sent' && b.result !== 'refused' && b.result !== 'retry') return 'result 는 sent·refused·retry 중 하나여야 합니다.'
  const reason = b.reason ?? null
  const detail = b.detail ?? null
  if (reason !== null && !(CONSOLE_ACK_REASONS as readonly unknown[]).includes(reason)) return 'reason 이 계약 목록에 없습니다.'
  if (b.result !== 'sent' && reason === null) return `${b.result} 에는 reason 이 필요합니다.`
  if (b.result === 'retry' && reason !== 'compacting') return 'retry 의 reason 은 compacting 뿐입니다.'
  if (detail !== null && (b.result !== 'sent' || !(CONSOLE_SENT_DETAILS as readonly unknown[]).includes(detail))) return 'detail 은 sent 에서 turn_started·submitted·accepted 중 하나입니다.'
  return null
}

/** 화면 한도 — 줄 수 · 한 줄 글자 수(코드포인트, 폴러가 자르는 단위) · 항목 합계 UTF-8 바이트(줄 바이트의 합, 개행 제외 — DB 검사·§4.1 과 같다). */
export const CONSOLE_SCREEN_LINE_MAX = 400
export const CONSOLE_SCREEN_BYTES_MAX = 8192
export const CONSOLE_SCREEN_ITEMS_MAX = 20
// 탭(U+0009)만 허용하는 제어 문자 — C0(탭 제외)·DEL·C1.
const SCREEN_CTRL = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/
/** 폴러가 읽은 시각 — ISO 8601(날짜·시각·시간대)만 받는다. Date.parse 는 '1' 같은 값도 받아 준다. */
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
/** 폴러 시계가 서버보다 앞서도 받아 주는 폭. 그보다 미래면 거절한다(잘못된 시각이 「최근 화면」 나이를 속이지 않게). */
const CAPTURE_SKEW_MS = 5 * 60_000

export type ConsoleScreenItem =
  | { kind: ConsoleTargetKind; ref: string; sha: string; capturedAt: string; lines: string[] }
  | { kind: ConsoleTargetKind; ref: string; sha: string; capturedAt: string; lines: null }

/** 화면 항목 하나를 검사한다. 통과하면 item, 아니면 rejected 사유(코드). lines 가 없으면 touch 다. */
export function parseConsoleScreenItem(raw: unknown, nowMs = Date.now()): { item: ConsoleScreenItem } | { reason: string; kind?: string; ref?: string } {
  if (raw === null || typeof raw !== 'object') return { reason: 'invalid_item' }
  const o = raw as Record<string, unknown>
  const kind = o.target_kind, ref = o.target_ref
  const echo = { kind: typeof kind === 'string' ? kind : undefined, ref: typeof ref === 'string' ? ref : undefined }
  if (typeof kind !== 'string' || !(CONSOLE_TARGET_KINDS as readonly string[]).includes(kind)) return { reason: 'invalid_target', ...echo }
  if (typeof ref !== 'string' || !CONSOLE_REF_RE.test(ref)) return { reason: 'invalid_target', ...echo }
  if (typeof o.sha !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha)) return { reason: 'invalid_sha', ...echo }
  if (typeof o.captured_at !== 'string' || !ISO_TS.test(o.captured_at)) return { reason: 'invalid_captured_at', ...echo }
  const capturedMs = Date.parse(o.captured_at)
  if (Number.isNaN(capturedMs) || capturedMs > nowMs + CAPTURE_SKEW_MS) return { reason: 'invalid_captured_at', ...echo }
  const capturedAt = new Date(capturedMs).toISOString()
  const base = { kind: kind as ConsoleTargetKind, ref, sha: o.sha, capturedAt }
  if (o.lines === undefined || o.lines === null) return { item: { ...base, lines: null } }
  if (!Array.isArray(o.lines)) return { reason: 'invalid_lines', ...echo }
  if (o.lines.length > CONSOLE_SCREEN_LINES) return { reason: 'too_many_lines', ...echo }
  const enc = new TextEncoder()
  let bytes = 0
  for (const line of o.lines) {
    if (typeof line !== 'string') return { reason: 'invalid_line', ...echo }
    if ([...line].length > CONSOLE_SCREEN_LINE_MAX) return { reason: 'line_too_long', ...echo }
    if (SCREEN_CTRL.test(line)) return { reason: 'control_char', ...echo }
    bytes += enc.encode(line).length
  }
  if (bytes > CONSOLE_SCREEN_BYTES_MAX) return { reason: 'too_large', ...echo }
  return { item: { ...base, lines: o.lines as string[] } }
}
