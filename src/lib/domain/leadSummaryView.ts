// 조정 팀장 자리 요약(lead_summary)의 화면 모델 — 계약 lane-summary-contract.md (A) 의 중요도 순서 1~6 을 그대로 따른다.
// 순수 함수만 둔다: 시간 경과는 호출자가 넘기는 nowMs 로 계산하고, 문구는 완전한 한국어 문장으로 만들어 화면은 그리기만 한다.
import { clockText, durationText, inputKindLabel, agoText } from './laneSummary'
import type { LeadRun, LeadSummary } from './watcherExtras'
import type { RosterDesk } from './agentRoster'

/** 마지막 tick 이 이 시간보다 오래되면(정확히 45분은 아니다) alive 를 빨강으로 보인다. */
export const LEAD_ALIVE_STALE_MS = 45 * 60_000

export type LeadTone = 'alert' | 'warn' | 'ok' | 'muted'
export type LeadItemId = 'decision' | 'merge' | 'progress' | 'lanes' | 'resource' | 'alive'

export interface LeadItemView {
  /** 중요도 순서 — 1 결정 · 2 머지 · 3 진행 · 4 레인 · 5 자원 · 6 alive. */
  order: 1 | 2 | 3 | 4 | 5 | 6
  id: LeadItemId
  label: string
  tone: LeadTone
  lines: string[]
  /** 1번(결정)만 — 건수가 있을 때의 배지 글자. */
  badge?: string
}
export interface LeadRunView { run: string; items: LeadItemView[] }
/** 책상 카드와 상세 머리에 같이 쓰는 결정 대기 배지 — 모든 회차의 합이다. */
export interface LeadDecisionBadge { count: number; pendingUser: number; open: number; firstTitle: string | null; text: string }
export interface LeadSummaryView { runs: LeadRunView[]; decision: LeadDecisionBadge | null }

function decisionItem(r: LeadRun): LeadItemView {
  const { pendingUser, open, firstTitle } = r.decision
  const count = pendingUser + open
  if (count === 0) return { order: 1, id: 'decision', label: '결정 대기', tone: 'muted', lines: ['결정을 기다리는 건이 없습니다.'] }
  const lines = [`결정 대기 ${count}건이 있습니다. 사용자 몫이 ${pendingUser}건, 미결 결정이 ${open}건입니다.`]
  if (firstTitle) lines.push(`첫 건의 제목은 「${firstTitle}」입니다.`)
  return { order: 1, id: 'decision', label: '결정 대기', tone: 'alert', lines, badge: `결정 대기 ${count}건` }
}

function mergeItem(r: LeadRun): LeadItemView {
  const { inFlight, queue } = r.merge
  const lines: string[] = []
  if (inFlight) lines.push(`${inFlight} 레인을 머지하고 있습니다.`)
  if (queue.length > 0) lines.push(`머지 대기 순서는 ${queue.join(' → ')} 입니다.`)
  if (lines.length === 0) lines.push('머지 중이거나 순서를 기다리는 레인이 없습니다.')
  return { order: 2, id: 'merge', label: '머지', tone: inFlight || queue.length > 0 ? 'ok' : 'muted', lines }
}

function progressItem(r: LeadRun, nowMs: number): LeadItemView {
  const { goal, startedAt, itemsDone, itemsTotal } = r.progress
  const lines: string[] = []
  if (goal) lines.push(`이번 회차의 목표는 「${goal}」입니다.`)
  const t = startedAt ? Date.parse(startedAt) : NaN
  if (!Number.isNaN(t)) lines.push(`시작 후 ${durationText(nowMs - t)} 경과했습니다.`)
  lines.push(itemsTotal > 0 ? `레인의 작업 항목 ${itemsTotal}개 가운데 ${itemsDone}개를 마쳤습니다.` : '집계된 레인 작업 항목이 없습니다.')
  return { order: 3, id: 'progress', label: '진행', tone: 'ok', lines }
}

function lanesItem(r: LeadRun): LeadItemView {
  const { working, waiting, done, quiet } = r.lanes
  const lines = [`작업 중인 레인이 ${working}개, 대기 중인 레인이 ${waiting}개, 끝난 레인이 ${done}개입니다.`]
  if (quiet.length > 0) lines.push(`보고 없이 오래 조용한 레인은 ${quiet.join(', ')} 입니다.`)
  return { order: 4, id: 'lanes', label: '레인', tone: quiet.length > 0 ? 'warn' : 'ok', lines }
}

function resourceItem(r: LeadRun): LeadItemView {
  const { band, five, week, loadAdjust, banned } = r.resource
  const usage: string[] = []
  if (band) usage.push(`구간 ${band}`)
  if (five !== null) usage.push(`5시간 ${five}%`)
  if (week !== null) usage.push(`주간 ${week}%`)
  const lines = [usage.length > 0 ? `사용량은 ${usage.join(', ')} 입니다.` : '사용량 정보가 없습니다.']
  lines.push(`부하 조절은 ${loadAdjust}회 했습니다.`)
  lines.push(banned ? '차단(banned) 상태입니다.' : '차단 상태는 아닙니다.')
  return { order: 5, id: 'resource', label: '자원', tone: banned ? 'alert' : 'ok', lines }
}

function aliveItem(r: LeadRun, nowMs: number): LeadItemView {
  const at = r.alive.lastTickAt
  const t = at ? Date.parse(at) : NaN
  if (Number.isNaN(t)) return { order: 6, id: 'alive', label: '생존', tone: 'warn', lines: ['마지막 tick 기록이 없습니다.'] }
  const stale = nowMs - t > LEAD_ALIVE_STALE_MS
  const ago = agoText(at, nowMs) ?? '—'
  return {
    order: 6, id: 'alive', label: '생존', tone: stale ? 'alert' : 'ok',
    lines: [stale ? `마지막 tick 이 ${ago}에 있었고, 오래 멈춰 있습니다.` : `마지막 tick 이 ${ago}에 있었습니다.`],
  }
}

/**
 * 팀장 자리 요약을 화면 모델로 바꾼다. 요약이 없으면(옛 킷·형식 오류) null — 화면이 「요약 없음」 을 쓴다.
 * 회차(runs[])마다 1~6 번 항목을 순서대로 만들고, 결정 대기 배지는 모든 회차의 합으로 따로 준다.
 */
export function buildLeadSummaryView(summary: LeadSummary | null | undefined, nowMs: number): LeadSummaryView | null {
  if (!summary) return null
  const runs: LeadRunView[] = summary.runs.map(r => ({
    run: r.run,
    items: [decisionItem(r), mergeItem(r), progressItem(r, nowMs), lanesItem(r), resourceItem(r), aliveItem(r, nowMs)],
  }))
  let pendingUser = 0, open = 0
  let firstTitle: string | null = null
  for (const r of summary.runs) {
    const n = r.decision.pendingUser + r.decision.open
    pendingUser += r.decision.pendingUser; open += r.decision.open
    if (firstTitle === null && n > 0) firstTitle = r.decision.firstTitle
  }
  const count = pendingUser + open
  return { runs, decision: count > 0 ? { count, pendingUser, open, firstTitle, text: `결정 ${count}건` } : null }
}

export interface LeadInputWait {
  /** 같은 PC 행의 임시 팀원 책상 중 입력 요청이 떠 있고 아직 아무도 처리하지 않은 수. */
  waiting: number
  /** 조정자·자동이 처리한 건의 기록 문장 — 건수에 세지 않고 줄로만 보인다. */
  records: string[]
}

/**
 * 팀장 상세의 「입력 대기 N건」 — 같은 PC 행(같은 소유자·host)의 책상 중 임시 팀원만 센다. 사용자 몫은 결정 대기 배지(1번)에 합쳐지므로
 * handled 가 있는 건은 건수에서 빼고 「처리됨」 기록 문장으로만 남긴다.
 */
export function leadInputWaits(desks: ReadonlyArray<Pick<RosterDesk, 'kind' | 'watcher' | 'temp'>>): LeadInputWait {
  let waiting = 0
  const rows: { lane: string; sentence: string }[] = []
  for (const d of desks) {
    if (d.kind !== 'temp') continue
    const req = d.watcher?.inputRequest
    if (!req) continue
    if (!req.handled) { waiting++; continue }
    const lane = d.watcher?.summary?.lane || d.temp?.lane || '레인 미상'
    const at = clockText(req.handled.at)
    const who = req.handled.by === 'auto' ? '자동으로' : '조정자가'
    rows.push({ lane, sentence: `${lane} 레인의 입력 요청(${inputKindLabel(req.kind)})은 ${who}${at ? ` ${at}에` : ''} 처리했습니다.` })
  }
  rows.sort((a, b) => a.lane.localeCompare(b.lane, undefined, { numeric: true }))
  return { waiting, records: rows.map(r => r.sentence) }
}
