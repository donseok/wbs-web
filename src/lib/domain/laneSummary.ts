// 레인 요약 — 조정자 킷이 watch 에 싣는 표시 전용 요약(계약 lane-summary-contract.md, v:1).
// 서버는 허용한 키만 다시 지어 저장한다(원본 jsonb 를 그대로 저장하지 않는다) — 다른 사용자도 seatmap 으로 읽는 칸이라
// 계약의 「비밀·경로·핸들·pid 는 싣지 않는다」 를 여기서 강제한다.
import { parseTempSlot } from './agentRoster'

export const LANE_SUMMARY_V = 1
/** 전체 2KB — 정규화한 객체를 JSON 으로 만든 UTF-8 바이트 수. 한글은 글자당 3바이트다. */
export const LANE_SUMMARY_MAX_BYTES = 2048
/** 문자열 상한은 킷이 자르는 값(brief 200·hold 사유 100)과 같거나 크게 둔다. 코드포인트 수로 잰다(DB char_length 와 같은 기준). */
const MAX = { lane: 60, state: 20, brief: 200, hold: 100, branch: 120 } as const

export interface LaneSummary {
  v: 1
  lane: string
  state: string
  brief: string
  itemsDone: number
  itemsTotal: number
  hold: string | null
  branch: string | null
  lastReportAt: string | null
  lastInstrAt: string | null
  ctxPct: number | null
  compactPending: boolean
}

export type LaneSummaryParse =
  | { ok: true; value: LaneSummary | null }
  | { ok: false; error: string }

export const cp = (s: string) => [...s].length
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function str(raw: Record<string, unknown>, key: string, max: number, required: boolean): string | null | { error: string } {
  const v = raw[key]
  if (v === undefined || v === null) return required ? { error: `summary.${key} 가 필요합니다.` } : null
  if (typeof v !== 'string') return { error: `summary.${key} 는 문자열이어야 합니다.` }
  const t = v.trim()
  if (required && t === '') return { error: `summary.${key} 가 비어 있습니다.` }
  if (cp(t) > max) return { error: `summary.${key} 는 ${max}자 이하여야 합니다.` }
  return t === '' ? null : t
}
export function count(raw: Record<string, unknown>, key: string): number | { error: string } {
  const v = raw[key]
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 9999) return { error: `summary.${key} 는 0~9999 정수여야 합니다.` }
  return v
}
export function iso(raw: Record<string, unknown>, key: string): string | null | { error: string } {
  const v = raw[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) return { error: `summary.${key} 는 ISO 시각이어야 합니다.` }
  return v
}

/**
 * watch 요청의 summary 를 검증해 정규화한다. 없으면(undefined·null) ok 와 null — 라벨만 보내는 옛 PC.
 * 모르는 키는 조용히 버린다(추가 필드 호환). 잘못된 값은 error — 호출자는 요약만 비우고 감시자 신호는 살린다.
 */
export function parseLaneSummary(raw: unknown): LaneSummaryParse {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!isObj(raw)) return { ok: false, error: 'summary 는 객체여야 합니다.' }
  if (raw.v !== LANE_SUMMARY_V) return { ok: false, error: `summary.v 는 ${LANE_SUMMARY_V} 이어야 합니다.` }
  const lane = str(raw, 'lane', MAX.lane, true)
  const state = str(raw, 'state', MAX.state, true)
  const brief = str(raw, 'brief', MAX.brief, false)
  const hold = str(raw, 'hold', MAX.hold, false)
  const branch = str(raw, 'branch', MAX.branch, false)
  const done = count(raw, 'items_done')
  const total = count(raw, 'items_total')
  const rep = iso(raw, 'last_report_at')
  const instr = iso(raw, 'last_instr_at')
  for (const x of [lane, state, brief, hold, branch, done, total, rep, instr]) {
    if (typeof x === 'object' && x !== null) return { ok: false, error: x.error }
  }
  let ctx: number | null = null
  if (raw.ctx_pct !== undefined && raw.ctx_pct !== null) {
    if (typeof raw.ctx_pct !== 'number' || !Number.isInteger(raw.ctx_pct) || raw.ctx_pct < 0 || raw.ctx_pct > 100) {
      return { ok: false, error: 'summary.ctx_pct 는 0~100 정수여야 합니다.' }
    }
    ctx = raw.ctx_pct
  }
  if (raw.compact_pending !== undefined && raw.compact_pending !== null && typeof raw.compact_pending !== 'boolean') {
    return { ok: false, error: 'summary.compact_pending 은 불리언이어야 합니다.' }
  }
  const value: LaneSummary = {
    v: 1, lane: lane as string, state: state as string, brief: (brief as string | null) ?? '',
    itemsDone: done as number, itemsTotal: total as number,
    hold: hold as string | null, branch: branch as string | null,
    lastReportAt: rep as string | null, lastInstrAt: instr as string | null,
    ctxPct: ctx, compactPending: raw.compact_pending === true,
  }
  if (new TextEncoder().encode(JSON.stringify(toWire(value))).length > LANE_SUMMARY_MAX_BYTES) {
    return { ok: false, error: `summary 는 전체 ${LANE_SUMMARY_MAX_BYTES}바이트 이하여야 합니다.` }
  }
  return { ok: true, value }
}

/** DB 에 저장하는 모양 — 계약의 snake_case 키 그대로(킷과 같은 말). */
export function toWire(s: LaneSummary): Record<string, unknown> {
  return {
    v: 1, lane: s.lane, state: s.state, brief: s.brief, items_done: s.itemsDone, items_total: s.itemsTotal,
    hold: s.hold, branch: s.branch, last_report_at: s.lastReportAt, last_instr_at: s.lastInstrAt,
    ctx_pct: s.ctxPct, compact_pending: s.compactPending,
  }
}

/** 저장된 jsonb 를 읽을 때 — 한 번 더 같은 검증을 거치고, 깨진 값은 null 로 둔다(표시를 막지 않는다). */
export function readLaneSummary(stored: unknown): LaneSummary | null {
  const r = parseLaneSummary(stored)
  return r.ok ? r.value : null
}

/** 경과 표기 — 「방금」·「n분 전」·「n시간 전」·「n일 전」. 시각이 없거나 읽을 수 없으면 null. 미래 시각은 방금으로 본다. */
export function agoText(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const min = Math.floor(Math.max(0, nowMs - t) / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`
}

export interface LaneSummaryRow {
  key: string
  lane: string
  /** 상태 라벨 — 요약이 있으면 그 state, 없으면 감시자 until 라벨. */
  state: string
  /** 요약이 없으면 null — 화면이 「요약 없음」 을 쓴다. */
  summary: LaneSummary | null
  reportAgo: string | null
  instrAgo: string | null
  items: string | null
  agent: string
}

interface RowWatcher { agent: string; untilLabel: string | null; lastSeenAt: string; summary?: LaneSummary | null }

/**
 * 상태 레인 보기의 레인 요약 행 — 임시 팀원(임시:<레인>·<요약>) 감시자만. 층마다 같은 감시자가 겹쳐 실리므로 agent 로 한 번만 센다.
 * 레인 이름은 요약의 lane, 없으면 슬롯의 레인. 레인 이름순(숫자는 수로).
 */
export function assembleLaneSummaryRows(floors: ReadonlyArray<{ watchers: readonly RowWatcher[] }>, nowMs: number): LaneSummaryRow[] {
  const byAgent = new Map<string, RowWatcher>()
  for (const f of floors) for (const w of f.watchers) {
    const cur = byAgent.get(w.agent)
    if (!cur || Date.parse(w.lastSeenAt) > Date.parse(cur.lastSeenAt)) byAgent.set(w.agent, w)
  }
  const rows: LaneSummaryRow[] = []
  for (const w of byAgent.values()) {
    const slot = w.agent.split('/').slice(2).join('/')
    const temp = parseTempSlot(slot)
    if (!temp) continue
    const s = w.summary ?? null
    rows.push({
      key: w.agent, agent: w.agent, lane: s?.lane || temp.lane,
      state: s?.state || w.untilLabel?.trim() || '상태 미상', summary: s,
      reportAgo: s ? agoText(s.lastReportAt, nowMs) : null,
      instrAgo: s ? agoText(s.lastInstrAt, nowMs) : null,
      items: s && s.itemsTotal > 0 ? `${s.itemsDone}/${s.itemsTotal}` : null,
    })
  }
  return rows.sort((a, b) => a.lane.localeCompare(b.lane, undefined, { numeric: true }) || a.agent.localeCompare(b.agent))
}
