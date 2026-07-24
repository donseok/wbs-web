/**
 * 간트 타임라인 스케일 계산 (순수 함수). WBS·간트 통합 시트와 전용 간트 뷰가 공유한다.
 * 입력은 계획 일자 목록(ISO 'YYYY-MM-DD')과 기준일·일당 픽셀. DB/DOM 의존 없음.
 */
export interface GanttScale {
  days: string[]
  rangeStart: string
  rangeEnd: string
  months: { ym: string; label: string; left: number; width: number }[]
  weeks: { label: string; sub: string; left: number; width: number }[]
  ganttW: number
  /** 날짜 → 타임라인 좌측 오프셋(px) */
  xOf: (date: string) => number
  isWeekend: (date: string) => boolean
  /** 기준일 세로선 위치(px). 날짜 범위가 기준일을 항상 포함하므로 정상 입력이면 항상 존재한다. */
  todayX: number | null
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function buildGanttScale(dates: string[], today: string, dayPx: number): GanttScale {
  const valid = dates.filter(Boolean)
  // WBS 첫 화면에서 기준일을 항상 보여 줄 수 있도록 일정 밖이어도 축에 포함한다.
  const axisDates = [...valid, today]
  const rangeStart = axisDates.reduce((a, b) => (a < b ? a : b))
  const rangeEnd = axisDates.reduce((a, b) => (a > b ? a : b))

  const start = new Date(rangeStart + 'T00:00:00Z')
  const end = new Date(rangeEnd + 'T00:00:00Z')
  const days: string[] = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d))

  const xOf = (date: string) =>
    ((new Date(date + 'T00:00:00Z').getTime() - start.getTime()) / 86_400_000) * dayPx
  const isWeekend = (d: string) => {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay()
    return dow === 0 || dow === 6
  }
  const ganttW = days.length * dayPx

  const months: GanttScale['months'] = []
  days.forEach((d, i) => {
    const ym = d.slice(0, 7)
    const last = months[months.length - 1]
    if (last && last.ym === ym) last.width += dayPx
    else months.push({ ym, label: `${Number(d.slice(5, 7))}월`, left: i * dayPx, width: dayPx })
  })

  const weeks: GanttScale['weeks'] = []
  for (let i = 0; i < days.length; i += 7) {
    const w = Math.min(7, days.length - i)
    const dd = days[i]
    weeks.push({
      label: 'W' + String(weeks.length + 1).padStart(2, '0'),
      sub: `${Number(dd.slice(5, 7))}/${Number(dd.slice(8, 10))}`,
      left: i * dayPx,
      width: w * dayPx,
    })
  }

  const todayX =
    days.length && today >= rangeStart && today <= rangeEnd ? xOf(today) + dayPx / 2 : null

  return { days, rangeStart, rangeEnd, months, weeks, ganttW, xOf, isWeekend, todayX }
}

/**
 * sticky 열에 가리지 않도록 기준일을 실제 타임라인 가시 영역의 중앙에 놓는 초기 scrollLeft.
 * timelineLeft/dateX는 스크롤 콘텐츠 좌표이고, frozenWidth만큼은 뷰포트 왼쪽을 계속 가린다.
 */
export function centeredTimelineScrollLeft({
  timelineLeft,
  dateX,
  frozenWidth,
  viewportWidth,
  scrollWidth,
}: {
  timelineLeft: number
  dateX: number
  frozenWidth: number
  viewportWidth: number
  scrollWidth: number
}): number {
  if (viewportWidth <= 0 || scrollWidth <= viewportWidth) return 0
  const occludedWidth = Math.min(Math.max(0, frozenWidth), viewportWidth)
  const visibleTimelineWidth = viewportWidth - occludedWidth
  const target = timelineLeft + dateX - occludedWidth - visibleTimelineWidth / 2
  return Math.min(Math.max(0, scrollWidth - viewportWidth), Math.max(0, target))
}

/** 트리에서 모든 계획 일자를 평탄 수집 */
export function collectPlannedDates(
  items: { plannedStart: string | null; plannedEnd: string | null; children: unknown[] }[],
): string[] {
  const out: string[] = []
  const walk = (ns: typeof items) =>
    ns.forEach(n => {
      if (n.plannedStart) out.push(n.plannedStart)
      if (n.plannedEnd) out.push(n.plannedEnd)
      walk((n.children as typeof items) ?? [])
    })
  walk(items)
  return out
}
