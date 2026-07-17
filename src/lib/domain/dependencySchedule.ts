import { businessDaysBetween, isBusinessDay } from './dates'
import type { TaskDependency } from './types'

export type { DependencyType, TaskDependency } from './types'

export interface ScheduleTask {
  id: string
  plannedStart: string | null
  plannedEnd: string | null
  /** 0~100. 실제 시작/종료일이 없으므로 남은 기간 추정에 사용한다. */
  actualPct: number
}

export interface TaskSchedule {
  plannedStart: string
  plannedEnd: string
  /** 계획 시작 하한과 선행 제약을 반영한 가장 이른 일정. */
  earliestStart: string
  earliestEnd: string
  /** 기준일 현재 실적에서 남은 작업량까지 반영한 예상 일정. */
  forecastStart: string
  forecastEnd: string
  latestStart: string
  latestEnd: string
  durationBusinessDays: number
  /** 계획 종료 대비 예상 종료의 달력일 차이. 간트 픽셀/사용자 표시용. */
  delayDays: number
  delayBusinessDays: number
  /** 선행 작업 제약으로 밀린 시작일의 달력일 차이. */
  dependencyDelayDays: number
  totalFloatBusinessDays: number
  overdue: boolean
  critical: boolean
  forecastConfidence: 'baseline' | 'estimated'
  drivenBy: string[]
}

export interface DependencySchedule {
  byId: Map<string, TaskSchedule>
  criticalTaskIds: Set<string>
  criticalDependencyIds: Set<string>
  cycleTaskIds: Set<string>
  blockedTaskIds: Set<string>
  unscheduledTaskIds: Set<string>
  invalidDependencyIds: Set<string>
  projectPlannedEnd: string | null
  projectForecastEnd: string | null
  projectDelayDays: number
  projectDelayBusinessDays: number
}

const DAY_MS = 86_400_000

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function calendarDaysBetween(start: string, end: string): number {
  return Math.max(0, Math.round((parse(end).getTime() - parse(start).getTime()) / DAY_MS))
}

/** 두 날짜 사이 영업일 이동량. 같은 날=0, start 뒤의 영업일부터 센다. */
function businessDayDistance(start: string, end: string, holidays: Set<string>): number {
  if (start === end) return 0
  if (start > end) return -businessDayDistance(end, start, holidays)
  const cursor = parse(start)
  let count = 0
  while (iso(cursor) < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isBusinessDay(iso(cursor), holidays)) count++
  }
  return count
}

/**
 * date에서 영업일 기준 amount만큼 이동한다. 양수는 미래, 음수는 과거.
 * amount=0이고 date가 휴일이면 다음 영업일로 정규화한다.
 */
export function shiftBusinessDays(date: string, amount: number, holidays: Set<string>): string {
  const cursor = parse(date)
  let left = Math.abs(Math.trunc(amount))
  const direction = amount < 0 ? -1 : 1
  if (left === 0 && isBusinessDay(iso(cursor), holidays)) return iso(cursor)
  do {
    cursor.setUTCDate(cursor.getUTCDate() + direction)
    if (isBusinessDay(iso(cursor), holidays) && left > 0) left--
  } while (left > 0 || !isBusinessDay(iso(cursor), holidays))
  return iso(cursor)
}

function endFromStart(start: string, duration: number, holidays: Set<string>): string {
  return duration <= 1 ? shiftBusinessDays(start, 0, holidays) : shiftBusinessDays(start, duration - 1, holidays)
}

function later(a: string, b: string): string {
  return a > b ? a : b
}

function earlier(a: string, b: string): string {
  return a < b ? a : b
}

/**
 * FS/SS 의존성으로 예상 일정을 전진 계산한 뒤 역방향 CPM으로 총여유와 크리티컬
 * 패스를 구한다. 계획일은 기준선으로만 사용하며 절대 변경하지 않는다.
 */
export function computeDependencySchedule(
  tasks: ScheduleTask[],
  dependencies: TaskDependency[],
  today: string,
  holidays: Iterable<string> = [],
): DependencySchedule {
  const holidaySet = new Set(holidays)
  const taskMap = new Map(tasks.map(task => [task.id, task]))
  const durationById = new Map<string, number>()
  const normalizedStartById = new Map<string, string>()
  const unscheduledTaskIds = new Set<string>()

  for (const task of tasks) {
    if (!task.plannedStart || !task.plannedEnd || task.plannedStart > task.plannedEnd) {
      unscheduledTaskIds.add(task.id)
      continue
    }
    const duration = businessDaysBetween(task.plannedStart, task.plannedEnd, holidaySet)
    if (duration <= 0) {
      unscheduledTaskIds.add(task.id)
      continue
    }
    durationById.set(task.id, duration)
    normalizedStartById.set(task.id, shiftBusinessDays(task.plannedStart, 0, holidaySet))
  }
  const validTaskIds = new Set(durationById.keys())
  const invalidDependencyIds = new Set<string>()
  const graphDeps: TaskDependency[] = []
  const seenPairs = new Set<string>()

  for (const dep of dependencies) {
    const pair = `${dep.predecessorId}>${dep.successorId}`
    if (
      dep.predecessorId === dep.successorId ||
      !taskMap.has(dep.predecessorId) ||
      !taskMap.has(dep.successorId) ||
      !validTaskIds.has(dep.predecessorId) ||
      !validTaskIds.has(dep.successorId) ||
      (dep.type !== 'FS' && dep.type !== 'SS') ||
      !Number.isInteger(dep.lagDays) || dep.lagDays < 0 || dep.lagDays > 365 ||
      seenPairs.has(pair)
    ) {
      invalidDependencyIds.add(dep.id)
    } else {
      seenPairs.add(pair)
      graphDeps.push(dep)
    }
  }

  const outgoing = new Map<string, TaskDependency[]>()
  for (const dep of graphDeps) {
    outgoing.set(dep.predecessorId, [...(outgoing.get(dep.predecessorId) ?? []), dep])
  }

  // Tarjan SCC — 순환 자체의 노드만 식별한다.
  const cycleTaskIds = new Set<string>()
  let visitIndex = 0
  const indices = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const visit = (id: string) => {
    indices.set(id, visitIndex)
    low.set(id, visitIndex++)
    stack.push(id)
    onStack.add(id)
    for (const dep of outgoing.get(id) ?? []) {
      const next = dep.successorId
      if (!indices.has(next)) {
        visit(next)
        low.set(id, Math.min(low.get(id)!, low.get(next)!))
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, indices.get(next)!))
      }
    }
    if (low.get(id) !== indices.get(id)) return
    const component: string[] = []
    let node: string
    do {
      node = stack.pop()!
      onStack.delete(node)
      component.push(node)
    } while (node !== id)
    if (component.length > 1) component.forEach(componentId => cycleTaskIds.add(componentId))
  }
  validTaskIds.forEach(id => { if (!indices.has(id)) visit(id) })

  // 순환 뒤의 후손은 제약을 알 수 없으므로 정상 작업처럼 낙관 계산하지 않는다.
  const blockedTaskIds = new Set<string>()
  const blockedQueue = [...cycleTaskIds]
  for (let i = 0; i < blockedQueue.length; i++) {
    for (const dep of outgoing.get(blockedQueue[i]) ?? []) {
      if (cycleTaskIds.has(dep.successorId) || blockedTaskIds.has(dep.successorId)) continue
      blockedTaskIds.add(dep.successorId)
      blockedQueue.push(dep.successorId)
    }
  }

  const usableDeps = graphDeps.filter(dep =>
    !cycleTaskIds.has(dep.predecessorId) && !cycleTaskIds.has(dep.successorId) &&
    !blockedTaskIds.has(dep.predecessorId) && !blockedTaskIds.has(dep.successorId),
  )
  const usableIncoming = new Map<string, TaskDependency[]>()
  const usableOutgoing = new Map<string, TaskDependency[]>()
  const indegree = new Map<string, number>()
  validTaskIds.forEach(id => indegree.set(id, 0))
  for (const dep of usableDeps) {
    usableIncoming.set(dep.successorId, [...(usableIncoming.get(dep.successorId) ?? []), dep])
    usableOutgoing.set(dep.predecessorId, [...(usableOutgoing.get(dep.predecessorId) ?? []), dep])
    indegree.set(dep.successorId, (indegree.get(dep.successorId) ?? 0) + 1)
  }
  const queue = [...validTaskIds].filter(id =>
    !cycleTaskIds.has(id) && !blockedTaskIds.has(id) && (indegree.get(id) ?? 0) === 0,
  )
  const order: string[] = []
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    order.push(id)
    for (const dep of usableOutgoing.get(id) ?? []) {
      const next = dep.successorId
      const degree = (indegree.get(next) ?? 0) - 1
      indegree.set(next, degree)
      if (degree === 0) queue.push(next)
    }
  }

  const byId = new Map<string, TaskSchedule>()
  for (const id of order) {
    const task = taskMap.get(id)!
    const plannedStart = task.plannedStart!
    const plannedEnd = task.plannedEnd!
    const duration = durationById.get(id)!
    let earliestStart = normalizedStartById.get(id)!
    let drivenBy: string[] = []

    for (const dep of usableIncoming.get(id) ?? []) {
      const predecessor = byId.get(dep.predecessorId)
      if (!predecessor) continue
      const constraint = dep.type === 'FS'
        ? shiftBusinessDays(predecessor.forecastEnd, dep.lagDays + 1, holidaySet)
        : shiftBusinessDays(predecessor.forecastStart, dep.lagDays, holidaySet)
      if (constraint > earliestStart) {
        earliestStart = constraint
        drivenBy = [dep.predecessorId]
      } else if (constraint === earliestStart) {
        drivenBy.push(dep.predecessorId)
      }
    }

    const earliestEnd = endFromStart(earliestStart, duration, holidaySet)
    let forecastEnd = earliestEnd
    let forecastConfidence: TaskSchedule['forecastConfidence'] = 'baseline'
    const actualPct = Math.min(100, Math.max(0, Number(task.actualPct) || 0))
    if (actualPct < 100 && earliestStart <= today) {
      const remainingDays = Math.max(1, Math.ceil(duration * (100 - actualPct) / 100))
      const resume = shiftBusinessDays(today, 1, holidaySet)
      const progressForecastEnd = endFromStart(resume, remainingDays, holidaySet)
      forecastEnd = later(forecastEnd, progressForecastEnd)
      forecastConfidence = 'estimated'
    }

    byId.set(id, {
      plannedStart,
      plannedEnd,
      earliestStart,
      earliestEnd,
      forecastStart: earliestStart,
      forecastEnd,
      latestStart: earliestStart,
      latestEnd: forecastEnd,
      durationBusinessDays: duration,
      delayDays: calendarDaysBetween(plannedEnd, forecastEnd),
      delayBusinessDays: Math.max(0, businessDayDistance(plannedEnd, forecastEnd, holidaySet)),
      dependencyDelayDays: calendarDaysBetween(plannedStart, earliestStart),
      totalFloatBusinessDays: 0,
      overdue: actualPct < 100 && plannedEnd < today,
      critical: false,
      forecastConfidence,
      drivenBy,
    })
  }

  // CPM은 의존성 네트워크에 참여한 작업을 대상으로 한다. 연결 없는 WBS 요약 행이
  // 크리티컬로 오인되는 것을 막으면서, SS 선행처럼 비종단 작업의 늦은 종료도 포함한다.
  const graphIds = new Set(usableDeps.flatMap(dep => [dep.predecessorId, dep.successorId]))
  const projectForecastEnd = [...graphIds].reduce<string | null>((latest, id) => {
    const end = byId.get(id)?.forecastEnd
    return end && (latest == null || end > latest) ? end : latest
  }, null)
  const projectPlannedEnd = [...graphIds].reduce<string | null>((latest, id) => {
    const end = taskMap.get(id)?.plannedEnd
    return end && (latest == null || end > latest) ? end : latest
  }, null)

  if (projectForecastEnd) {
    // 모든 작업을 프로젝트 예상 종료에 맞춘 뒤, 후속 제약을 역방향으로 전파한다.
    for (const id of graphIds) {
      const schedule = byId.get(id)
      if (!schedule) continue
      const effectiveDuration = Math.max(1, businessDaysBetween(schedule.forecastStart, schedule.forecastEnd, holidaySet))
      schedule.latestStart = shiftBusinessDays(projectForecastEnd, -(effectiveDuration - 1), holidaySet)
      schedule.latestEnd = projectForecastEnd
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const predecessorId = order[i]
      const predecessor = byId.get(predecessorId)
      if (!predecessor || !graphIds.has(predecessorId)) continue
      const predecessorDuration = Math.max(1, businessDaysBetween(predecessor.forecastStart, predecessor.forecastEnd, holidaySet))
      for (const dep of usableOutgoing.get(predecessorId) ?? []) {
        const successor = byId.get(dep.successorId)
        if (!successor) continue
        const bound = dep.type === 'FS'
          ? shiftBusinessDays(successor.latestStart, -(dep.lagDays + predecessorDuration), holidaySet)
          : shiftBusinessDays(successor.latestStart, -dep.lagDays, holidaySet)
        predecessor.latestStart = earlier(predecessor.latestStart, bound)
      }
      predecessor.latestEnd = endFromStart(predecessor.latestStart, predecessorDuration, holidaySet)
    }
  }

  const criticalTaskIds = new Set<string>()
  for (const id of graphIds) {
    const schedule = byId.get(id)
    if (!schedule) continue
    schedule.totalFloatBusinessDays = Math.max(
      0,
      businessDayDistance(schedule.forecastStart, schedule.latestStart, holidaySet),
    )
    schedule.critical = schedule.totalFloatBusinessDays === 0
    if (schedule.critical) criticalTaskIds.add(id)
  }
  const criticalDependencyIds = new Set<string>()
  for (const dep of usableDeps) {
    if (!criticalTaskIds.has(dep.predecessorId) || !criticalTaskIds.has(dep.successorId)) continue
    const predecessor = byId.get(dep.predecessorId)!
    const successor = byId.get(dep.successorId)!
    const constraint = dep.type === 'FS'
      ? shiftBusinessDays(predecessor.forecastEnd, dep.lagDays + 1, holidaySet)
      : shiftBusinessDays(predecessor.forecastStart, dep.lagDays, holidaySet)
    if (constraint === successor.forecastStart) criticalDependencyIds.add(dep.id)
  }

  return {
    byId,
    criticalTaskIds,
    criticalDependencyIds,
    cycleTaskIds,
    blockedTaskIds,
    unscheduledTaskIds,
    invalidDependencyIds,
    projectPlannedEnd,
    projectForecastEnd,
    projectDelayDays: projectPlannedEnd && projectForecastEnd
      ? calendarDaysBetween(projectPlannedEnd, projectForecastEnd)
      : 0,
    projectDelayBusinessDays: projectPlannedEnd && projectForecastEnd
      ? Math.max(0, businessDayDistance(projectPlannedEnd, projectForecastEnd, holidaySet))
      : 0,
  }
}
