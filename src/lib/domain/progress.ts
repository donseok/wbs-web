import { businessDaysBetween } from './dates'
import type { Status } from './types'

/** 계획% 계산의 유일한 구현. 업무일 세는 법만 주입받는다. */
export function plannedPctWith(
  start: string | null, end: string | null, today: string,
  between: (a: string, b: string) => number,
): number {
  if (!start || !end) return 0
  if (today < start) return 0
  const total = between(start, end)
  if (total === 0) return 0
  const cappedToday = today > end ? end : today
  const done = between(start, cappedToday)
  const pct = (done / total) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

export function plannedPct(
  start: string | null, end: string | null, today: string, holidays: Set<string>,
): number {
  return plannedPctWith(start, end, today, (a, b) => businessDaysBetween(a, b, holidays))
}

export function achievementOf(actual: number, planned: number): number | null {
  if (planned === 0) return null
  return Math.round((actual / planned) * 100)
}

export function statusOf(
  actual: number, planned: number, start: string | null, today: string,
): Status {
  if (actual >= 100) return 'done'
  if (start && today < start && actual === 0) return 'not_started'
  if (planned === 0 && actual === 0) return 'not_started'
  if (actual < planned) return 'delayed'
  return 'in_progress'
}
