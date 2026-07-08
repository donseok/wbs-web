import { addDaysCal, diffDaysCal, milestoneLeaves, scheduleModel } from './dashboard'
import { makeBizDayIndex } from './dates'
import { overallPlannedAt, overallProgress } from './rollup'
import type { ComputedItem } from './types'

export interface JourneyPoint { date: string; x: number; planned: number }
export interface JourneyBand { id: string; name: string; x0: number; x1: number; fillPct: number; started: boolean }
export interface JourneyMilestone { id: string; name: string; date: string; x: number; done: boolean }
/** x는 창 안으로 클립된 위치. clipped면 x===1이고 카드가 오른쪽 가장자리에 꺾쇠를 그린다. */
export interface JourneyForecast { x: number; slipDays: number; clipped: boolean; projectedEnd: string }

export interface JourneyModel {
  curve: JourneyPoint[]
  bands: JourneyBand[]
  milestones: JourneyMilestone[]
  todayX: number
  actual: number
  planned: number
  variance: number
  /** 종료일의 계획 진척. 정상이면 100. 100 미만이면 업무일 0짜리 리프가 섞였다는 뜻. */
  terminalPlanned: number
  elapsed: number
  earlyFloor: number
  /** earlyFloor 지점의 x. 예측 산정 시작일 눈금용. label!=='early'면 null. */
  earlyFloorX: number | null
  forecast: JourneyForecast | null
}

/** 곡선이 꺾이는 곳은 단계 경계뿐이다. 주 단위 + 경계 + {시작, 오늘, 종료}면 충분하다. */
function sampleDates(roots: ComputedItem[], startDate: string, endDate: string, today: string): string[] {
  const set = new Set<string>([startDate, endDate])
  if (today >= startDate && today <= endDate) set.add(today)

  const span = diffDaysCal(startDate, endDate)
  for (let d = 0; d <= span; d += 7) set.add(addDaysCal(startDate, d))

  const clamp = (s: string) => (s < startDate ? startDate : s > endDate ? endDate : s)
  roots.forEach(p => {
    if (p.plannedStart) set.add(clamp(p.plannedStart))
    if (p.plannedEnd) set.add(clamp(p.plannedEnd))
  })
  return [...set].sort()
}

export function buildJourney(
  roots: ComputedItem[],
  opts: { startDate: string | null; endDate: string | null; today: string; holidays: string[] },
): JourneyModel | null {
  const { startDate, endDate, today, holidays } = opts
  if (!startDate || !endDate || roots.length === 0) return null

  const span = Math.max(1, diffDaysCal(startDate, endDate))
  const xOf = (d: string) => Math.min(1, Math.max(0, diffDaysCal(startDate, d) / span))

  const idx = makeBizDayIndex(startDate, endDate, new Set(holidays))
  const curve = sampleDates(roots, startDate, endDate, today)
    .map(date => ({ date, x: xOf(date), planned: overallPlannedAt(roots, date, idx) }))

  const { actual, planned } = overallProgress(roots)
  const sched = scheduleModel({ startDate, endDate, today, overallActual: actual, overallPlanned: planned })

  const bands: JourneyBand[] = roots.map(p => ({
    id: p.id,
    name: p.name,
    x0: xOf(p.plannedStart ?? startDate),
    x1: xOf(p.plannedEnd ?? endDate),
    fillPct: p.plannedPct,
    started: p.plannedStart != null && today >= p.plannedStart,
  }))

  const milestones: JourneyMilestone[] = milestoneLeaves(roots).map(l => ({
    id: l.id,
    name: l.name,
    date: l.plannedEnd!,
    x: xOf(l.plannedEnd!),
    done: l.status === 'done',
  }))

  // 예측선은 label이 아니라 projectedEnd의 존재로 게이팅한다.
  // label==='onTrack'은 "정상"이 아니라 "early도 done도 아님"일 뿐이고, slip +368일에도 켜진다.
  const forecast: JourneyForecast | null = sched.projectedEnd
    ? {
        projectedEnd: sched.projectedEnd,
        slipDays: sched.slipDays ?? 0,
        clipped: sched.projectedEnd > endDate,
        x: xOf(sched.projectedEnd),   // xOf가 1로 클램프한다 — x축은 재스케일하지 않는다
      }
    : null

  return {
    curve,
    bands,
    milestones,
    todayX: xOf(today),
    actual,
    planned,
    variance: actual - planned,
    terminalPlanned: overallPlannedAt(roots, endDate, idx),
    elapsed: sched.elapsed,
    earlyFloor: sched.earlyFloor,
    earlyFloorX: sched.label === 'early' ? xOf(addDaysCal(startDate, sched.earlyFloor - 1)) : null,
    forecast,
  }
}
