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
