// src/lib/ai/commands/parse.ts
// 명령 파싱 — 결정형 패턴 우선(쿼터 절약+데모 결정성), 실패 시에만 LLM 1콜.
import { generateAnswer } from '@/lib/ai/llm'
import type { CommandAction, ParsedCommand } from './types'

const ACTUAL_RE =
  /^(.+?)\s*(?:의\s*)?실적\s*(\d{1,3})\s*%?\s*(?:으로|로)\s*(?:올려|변경|바꿔|수정)/
const COMPLETE_RE = /^(.+?)\s*(?:을|를)?\s*완료\s*(?:처리|로)/

export function parseDeterministic(raw: string): ParsedCommand | null {
  const t = raw.trim()
  const m1 = ACTUAL_RE.exec(t)
  if (m1) {
    const pct = Number(m1[2])
    if (pct >= 0 && pct <= 100) {
      return { action: 'set_actual', targetQuery: m1[1].trim(), actualPct: pct }
    }
    return null // 범위 밖 — LLM이 되물을 수 있게 넘긴다
  }
  const m2 = COMPLETE_RE.exec(t)
  if (m2) return { action: 'complete', targetQuery: m2[1].trim() }
  return null
}

export function extractJson(text: string): unknown | null {
  const stripped = text.replace(/```(?:json)?/g, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ACTIONS: CommandAction[] = ['set_actual', 'set_dates', 'complete']

export function validateParsed(v: unknown): ParsedCommand | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const action = o.action as CommandAction
  if (!ACTIONS.includes(action)) return null
  const targetQuery = typeof o.targetQuery === 'string' ? o.targetQuery.trim() : ''
  if (!targetQuery) return null
  const out: ParsedCommand = { action, targetQuery }
  if (action === 'set_actual') {
    const pct = Number(o.actualPct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null
    out.actualPct = pct
  }
  if (action === 'set_dates') {
    const s = o.plannedStart, e = o.plannedEnd
    if (s != null && (typeof s !== 'string' || !DATE_RE.test(s))) return null
    if (e != null && (typeof e !== 'string' || !DATE_RE.test(e))) return null
    if (s == null && e == null) return null
    if (s != null) out.plannedStart = s
    if (e != null) out.plannedEnd = e
  }
  return out
}

const PARSE_SYSTEM = `너는 WBS 명령 파서다. 사용자의 한국어 명령을 JSON 하나로만 변환한다.
스키마: {"action":"set_actual|set_dates|complete","targetQuery":"작업명 표현","actualPct":숫자?,"plannedStart":"YYYY-MM-DD"?,"plannedEnd":"YYYY-MM-DD"?}
규칙: JSON 외 텍스트 금지. 날짜는 반드시 YYYY-MM-DD (연도 불명시는 2026). 명령이 아니면 {"action":"none"}을 출력.`

export async function parseCommand(raw: string): Promise<ParsedCommand | null> {
  const det = parseDeterministic(raw)
  if (det) return det
  const text = await generateAnswer(PARSE_SYSTEM, [{ role: 'user', content: raw.trim() }])
  if (!text) return null
  return validateParsed(extractJson(text))
}
