import { businessDaysBetween } from './dates'
import { round1 } from './format'
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
  return Math.min(100, Math.max(0, round1(pct)))
}

/* 달성율·상태 판정은 정수 반올림 기준을 유지한다(입력이 소수 1자리가 된 뒤에도).
 * 그대로 소수를 쓰면 (1) planned 0.1~0.4에서 0-가드가 무력화되어 not_started가
 * delayed로 뒤집히고 달성율이 폭주하며(0.4 계획·45 실적 → 11250%),
 * (2) 0.1%p 차이로 지연 판정이 나 정수 표기 화면(계획 33%/실적 33% '지연')과 모순된다. */

export function achievementOf(actual: number, planned: number): number | null {
  const p = Math.round(planned)
  if (p === 0) return null
  return Math.round((Math.round(actual) / p) * 100)
}

export function statusOf(
  actual: number, planned: number, start: string | null, today: string,
): Status {
  // done만은 원시값 비교 — 반올림하면 실적 99.5가 완료 처리된다(집계·알림·칸반 전파).
  if (actual >= 100) return 'done'
  const a = Math.round(actual)
  const p = Math.round(planned)
  if (start && today < start && a === 0) return 'not_started'
  if (p === 0 && a === 0) return 'not_started'
  if (a < p) return 'delayed'
  return 'in_progress'
}
