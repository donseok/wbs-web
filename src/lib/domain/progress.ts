import { businessDaysBetween } from './dates'
import type { Status } from './types'

export function plannedPct(
  start: string | null, end: string | null, today: string, holidays: Set<string>,
): number {
  if (!start || !end) return 0
  if (today < start) return 0
  const total = businessDaysBetween(start, end, holidays)
  if (total === 0) return 0
  const cappedToday = today > end ? end : today
  const done = businessDaysBetween(start, cappedToday, holidays)
  const pct = (done / total) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
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
