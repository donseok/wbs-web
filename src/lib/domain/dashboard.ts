import type { ComputedItem } from './types'
import { collectLeaves } from '@/components/wbs/shared'

export type Signal = 'green' | 'amber' | 'red' | 'neutral'

/* ── 캘린더 일수(UTC, DST 무관) — DashboardView 로컬 헬퍼와 동일 관례 ── */
const DAY = 86_400_000
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`)
export const diffDaysCal = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY)
export const addDaysCal = (s: string, n: number) =>
  new Date(ms(s) + n * DAY).toISOString().slice(0, 10)

/** 진척 신호 — 편차(실적−계획, %p) 기준. 경계는 green/amber가 소유. */
export function progressSignal(variance: number): Signal {
  if (variance >= -2) return 'green'
  if (variance >= -10) return 'amber'
  return 'red'
}

export interface ScheduleModel {
  totalDays: number; elapsed: number; remaining: number; elapsedPct: number
  projectedEnd: string | null; slipDays: number | null
  signal: Signal; label: 'onTrack' | 'early' | 'done' | 'none'
}

const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function scheduleModel(input: {
  startDate: string | null; endDate: string | null; today: string
  overallActual: number; overallPlanned: number
}): ScheduleModel {
  const { startDate: s, endDate: e, today, overallActual, overallPlanned } = input
  if (!s || !e) {
    return { totalDays: 0, elapsed: 0, remaining: 0, elapsedPct: 0, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'none' }
  }
  const totalDays = Math.max(1, diffDaysCal(s, e) + 1)
  const elapsed = clampN(diffDaysCal(s, today) + 1, 0, totalDays)
  const remaining = totalDays - elapsed
  const elapsedPct = Math.round((elapsed / totalDays) * 100)
  const base = { totalDays, elapsed, remaining, elapsedPct }

  // 완료 예외 — 종료일 경과여도 done이면 정상
  if (overallActual >= 100) return { ...base, projectedEnd: null, slipDays: null, signal: 'green', label: 'done' }
  // 조기 가드 — SPI 불안정 구간은 정직하게 회색(초록 아님)
  const earlyFloor = Math.max(14, Math.round(totalDays * 0.15))
  if (overallPlanned < 5 || elapsed < earlyFloor) {
    return { ...base, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'early' }
  }
  const spi = overallActual / overallPlanned            // planned ≥ 5 → 안전
  const projectedDuration = Math.min(totalDays / spi, totalDays * 3) // clamp: 최대 3×
  const slipDays = Math.round(projectedDuration - totalDays)
  const projectedEnd = addDaysCal(s, Math.round(projectedDuration) - 1)
  const overdueUnfinished = today > e                   // done 가드 통과 = 미완료
  const signal: Signal = slipDays > 14 || overdueUnfinished ? 'red' : slipDays > 3 ? 'amber' : 'green'
  return { ...base, projectedEnd, slipDays, signal, label: 'onTrack' }
}
