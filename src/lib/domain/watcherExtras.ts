// 감시자 watch 에 실리는 나머지 두 표시 전용 칸 — 팀장 자리 요약(lead_summary)·입력 요청(input_request).
// 레인 요약(summary)과 같은 규칙: 허용한 키만 다시 지어 저장하고, 잘못된 값은 그 칸만 null 로 두며(호출자가 summary_error 를 싣는다),
// 감시자 생존 신호는 끊지 않는다. 계약: lanes/lane-summary-contract.md (A)(B).
import { count, cp, iso, isObj, str } from './laneSummary'

const asErr = (x: unknown): x is { error: string } => typeof x === 'object' && x !== null && 'error' in x

// ───────────────────────── (A) 팀장 자리 요약

export const LEAD_SUMMARY_MAX_BYTES = 8192
const RUNS_MAX = 5
const NAMES_MAX = 10

export interface LeadRun {
  run: string
  /** pending_user: 사용자 몫으로 넘긴 건수, open: decisions 미결 건수, firstTitle: 첫 건 제목(100자). */
  decision: { pendingUser: number; open: number; firstTitle: string | null }
  merge: { inFlight: string | null; queue: string[] }
  progress: { goal: string | null; startedAt: string | null; itemsDone: number; itemsTotal: number }
  lanes: { working: number; waiting: number; done: number; quiet: string[] }
  /** five·week 는 사용량 비율(0~100 정수), 모르면 null. */
  resource: { band: string | null; five: number | null; week: number | null; loadAdjust: number; banned: boolean }
  alive: { lastTickAt: string | null }
}
export interface LeadSummary { v: 1; runs: LeadRun[] }

function nameList(raw: unknown, key: string, maxItems: number, maxLen: number): string[] | { error: string } {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > maxItems) return { error: `${key} 는 ${maxItems}개 이하 배열이어야 합니다.` }
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || x.trim() === '' || cp(x.trim()) > maxLen) return { error: `${key} 항목은 1~${maxLen}자 문자열이어야 합니다.` }
    out.push(x.trim())
  }
  return out
}
function pct(raw: Record<string, unknown>, key: string): number | null | { error: string } {
  const v = raw[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) return { error: `${key} 는 0~100 정수여야 합니다.` }
  return v
}
function sub(raw: Record<string, unknown>, key: string): Record<string, unknown> | { error: string } {
  const v = raw[key]
  if (v === undefined || v === null) return {}
  return isObj(v) ? v : { error: `${key} 는 객체여야 합니다.` }
}

function parseRun(raw: unknown): LeadRun | { error: string } {
  if (!isObj(raw)) return { error: 'runs 항목은 객체여야 합니다.' }
  const run = str(raw, 'run', 60, true)
  const dec = sub(raw, 'decision'), mer = sub(raw, 'merge'), pro = sub(raw, 'progress')
  const lan = sub(raw, 'lanes'), res = sub(raw, 'resource'), ali = sub(raw, 'alive')
  for (const x of [run, dec, mer, pro, lan, res, ali]) if (asErr(x)) return x
  const d = dec as Record<string, unknown>, m = mer as Record<string, unknown>, p = pro as Record<string, unknown>
  const l = lan as Record<string, unknown>, r = res as Record<string, unknown>, a = ali as Record<string, unknown>
  const pendingUser = count(d, 'pending_user'), open = count(d, 'open'), firstTitle = str(d, 'first_title', 100, false)
  const inFlight = str(m, 'in_flight', 60, false), queue = nameList(m.queue, 'merge.queue', NAMES_MAX, 60)
  const goal = str(p, 'goal', 120, false), startedAt = iso(p, 'started_at'), done = count(p, 'items_done'), total = count(p, 'items_total')
  const working = count(l, 'working'), waiting = count(l, 'waiting'), laneDone = count(l, 'done'), quiet = nameList(l.quiet, 'lanes.quiet', NAMES_MAX, 60)
  const band = str(r, 'band', 20, false), five = pct(r, 'five'), week = pct(r, 'week'), loadAdjust = count(r, 'load_adjust')
  const tick = iso(a, 'last_tick_at')
  for (const x of [pendingUser, open, firstTitle, inFlight, queue, goal, startedAt, done, total, working, waiting, laneDone, quiet, band, five, week, loadAdjust, tick]) {
    if (asErr(x)) return x
  }
  if (r.banned !== undefined && r.banned !== null && typeof r.banned !== 'boolean') return { error: 'resource.banned 는 불리언이어야 합니다.' }
  return {
    run: run as string,
    decision: { pendingUser: pendingUser as number, open: open as number, firstTitle: firstTitle as string | null },
    merge: { inFlight: inFlight as string | null, queue: queue as string[] },
    progress: { goal: goal as string | null, startedAt: startedAt as string | null, itemsDone: done as number, itemsTotal: total as number },
    lanes: { working: working as number, waiting: waiting as number, done: laneDone as number, quiet: quiet as string[] },
    resource: { band: band as string | null, five: five as number | null, week: week as number | null, loadAdjust: loadAdjust as number, banned: r.banned === true },
    alive: { lastTickAt: tick as string | null },
  }
}

export type Parsed<T> = { ok: true; value: T | null } | { ok: false; error: string }

export function leadSummaryWire(s: LeadSummary): Record<string, unknown> {
  return {
    v: 1,
    runs: s.runs.map(r => ({
      run: r.run,
      decision: { pending_user: r.decision.pendingUser, open: r.decision.open, first_title: r.decision.firstTitle },
      merge: { in_flight: r.merge.inFlight, queue: r.merge.queue },
      progress: { goal: r.progress.goal, started_at: r.progress.startedAt, items_done: r.progress.itemsDone, items_total: r.progress.itemsTotal },
      lanes: { working: r.lanes.working, waiting: r.lanes.waiting, done: r.lanes.done, quiet: r.lanes.quiet },
      resource: { band: r.resource.band, five: r.resource.five, week: r.resource.week, load_adjust: r.resource.loadAdjust, banned: r.resource.banned },
      alive: { last_tick_at: r.alive.lastTickAt },
    })),
  }
}

export function parseLeadSummary(raw: unknown): Parsed<LeadSummary> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!isObj(raw)) return { ok: false, error: 'lead_summary 는 객체여야 합니다.' }
  if (raw.v !== 1) return { ok: false, error: 'lead_summary.v 는 1 이어야 합니다.' }
  if (!Array.isArray(raw.runs) || raw.runs.length > RUNS_MAX) return { ok: false, error: `lead_summary.runs 는 ${RUNS_MAX}개 이하 배열이어야 합니다.` }
  const runs: LeadRun[] = []
  for (const r of raw.runs) {
    const p = parseRun(r)
    if (asErr(p)) return { ok: false, error: `lead_summary.${p.error}` }
    runs.push(p)
  }
  const value: LeadSummary = { v: 1, runs }
  if (new TextEncoder().encode(JSON.stringify(leadSummaryWire(value))).length > LEAD_SUMMARY_MAX_BYTES) {
    return { ok: false, error: `lead_summary 는 전체 ${LEAD_SUMMARY_MAX_BYTES}바이트 이하여야 합니다.` }
  }
  return { ok: true, value }
}
export function readLeadSummary(stored: unknown): LeadSummary | null {
  const r = parseLeadSummary(stored)
  return r.ok ? r.value : null
}

// ───────────────────────── (B) 입력 요청

export const INPUT_KINDS = ['permission', 'question', 'choice', 'usage-limit', 'trust', 'message'] as const
export type InputKind = typeof INPUT_KINDS[number]
export const INPUT_EXCERPT_LINES = 10
export const INPUT_LINE_MAX = 200
export const INPUT_REQUEST_MAX_BYTES = 3072

export interface InputHandled { by: 'coordinator' | 'auto'; at: string }
export interface InputRequest {
  v: 1
  kind: InputKind
  /** 이 입력 창이 처음 감지된 시각 — 대기 시간의 기준이자 답하기 요청의 대조 값이다. */
  since: string
  excerpt: string[]
  handled: InputHandled | null
  /** 발췌의 sha256(hex) — 서버가 저장할 때 계산한다. 킷이 보내는 값은 받지 않는다. 답하기 요청이 이 값으로 같은 창임을 대조한다. */
  sha: string
}

/** 해시 재료 — 줄을 `\n` 으로 이은 UTF-8. PC 폴러가 재판정할 때도 같은 규칙으로 계산한다. */
export function excerptMaterial(lines: readonly string[]): string { return lines.join('\n') }

/**
 * watch 의 input_request 를 검증한다. sha 는 호출자가 넘기는 함수로 계산한다(도메인을 node:crypto 에 묶지 않는다).
 * 줄 수는 10줄, 줄 길이는 200자까지다. 받은 sha 는 무시한다.
 */
export function parseInputRequest(raw: unknown, sha256: (material: string) => string): Parsed<InputRequest> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!isObj(raw)) return { ok: false, error: 'input_request 는 객체여야 합니다.' }
  if (raw.v !== 1) return { ok: false, error: 'input_request.v 는 1 이어야 합니다.' }
  if (typeof raw.kind !== 'string' || !(INPUT_KINDS as readonly string[]).includes(raw.kind)) {
    return { ok: false, error: `input_request.kind 는 ${INPUT_KINDS.join('·')} 중 하나여야 합니다.` }
  }
  const since = iso(raw, 'since')
  if (asErr(since)) return { ok: false, error: `input_request.${since.error}` }
  if (since === null) return { ok: false, error: 'input_request.since 가 필요합니다.' }
  if (!Array.isArray(raw.excerpt) || raw.excerpt.length > INPUT_EXCERPT_LINES) {
    return { ok: false, error: `input_request.excerpt 는 ${INPUT_EXCERPT_LINES}줄 이하 배열이어야 합니다.` }
  }
  const excerpt: string[] = []
  for (const l of raw.excerpt) {
    if (typeof l !== 'string' || cp(l) > INPUT_LINE_MAX) return { ok: false, error: `input_request.excerpt 줄은 ${INPUT_LINE_MAX}자 이하 문자열이어야 합니다.` }
    excerpt.push(l.replace(/\s+$/, ''))
  }
  let handled: InputHandled | null = null
  if (raw.handled !== undefined && raw.handled !== null) {
    const h = raw.handled
    if (!isObj(h) || (h.by !== 'coordinator' && h.by !== 'auto')) return { ok: false, error: "input_request.handled.by 는 'coordinator' 또는 'auto' 여야 합니다." }
    const at = iso(h, 'at')
    if (asErr(at) || at === null) return { ok: false, error: 'input_request.handled.at 은 ISO 시각이어야 합니다.' }
    handled = { by: h.by, at }
  }
  const value: InputRequest = { v: 1, kind: raw.kind as InputKind, since, excerpt, handled, sha: sha256(excerptMaterial(excerpt)) }
  if (new TextEncoder().encode(JSON.stringify(value)).length > INPUT_REQUEST_MAX_BYTES) {
    return { ok: false, error: `input_request 는 전체 ${INPUT_REQUEST_MAX_BYTES}바이트 이하여야 합니다.` }
  }
  return { ok: true, value }
}

/** 저장된 jsonb 를 읽을 때 — 형식이 깨졌거나 sha 가 없으면 null(표시·답하기를 막는다, fail-closed). 저장된 sha 를 그대로 믿지 않고 발췌에서 다시 계산하지 않는다 — 계산은 쓰기 때 한 번이다. */
export function readInputRequest(stored: unknown): InputRequest | null {
  if (!isObj(stored) || typeof stored.sha !== 'string' || !/^[0-9a-f]{64}$/.test(stored.sha)) return null
  const r = parseInputRequest(stored, () => stored.sha as string)
  return r.ok ? r.value : null
}
