import { describe, expect, it } from 'vitest'
import { computeDependencySchedule, shiftBusinessDays, type ScheduleTask } from '@/lib/domain/dependencySchedule'
import type { DependencyType, TaskDependency } from '@/lib/domain/types'

const task = (
  id: string,
  plannedStart: string | null,
  plannedEnd: string | null,
  actualPct = 100,
): ScheduleTask => ({ id, plannedStart, plannedEnd, actualPct })

const dep = (
  id: string,
  predecessorId: string,
  successorId: string,
  type: DependencyType = 'FS',
  lagDays = 0,
): TaskDependency => ({ id, projectId: 'p1', predecessorId, successorId, type, lagDays })

describe('shiftBusinessDays', () => {
  it('주말·공휴일을 건너 양방향으로 이동한다', () => {
    const holidays = new Set(['2026-07-17']) // 금요일 제헌절
    expect(shiftBusinessDays('2026-07-16', 1, holidays)).toBe('2026-07-20')
    expect(shiftBusinessDays('2026-07-20', -1, holidays)).toBe('2026-07-16')
    expect(shiftBusinessDays('2026-07-18', 0, holidays)).toBe('2026-07-20')
  })
})

describe('computeDependencySchedule', () => {
  it('FS는 선행 종료 다음 영업일, lag는 추가 영업일로 계산한다', () => {
    const holidays = ['2026-07-17']
    const tasks = [task('A', '2026-07-13', '2026-07-16'), task('B', '2026-07-13', '2026-07-14')]
    const fs0 = computeDependencySchedule(tasks, [dep('d0', 'A', 'B')], '2026-07-01', holidays)
    expect(fs0.byId.get('B')?.forecastStart).toBe('2026-07-20')

    const fs1 = computeDependencySchedule(tasks, [dep('d1', 'A', 'B', 'FS', 1)], '2026-07-01', holidays)
    expect(fs1.byId.get('B')?.forecastStart).toBe('2026-07-21')
  })

  it('SS는 시작일을 기준으로 동시 또는 lag 시작한다', () => {
    const holidays = ['2026-07-17']
    const tasks = [task('A', '2026-07-16', '2026-07-21'), task('B', '2026-07-13', '2026-07-14')]
    const ss0 = computeDependencySchedule(tasks, [dep('d0', 'A', 'B', 'SS')], '2026-07-01', holidays)
    expect(ss0.byId.get('B')?.forecastStart).toBe('2026-07-16')
    const ss1 = computeDependencySchedule(tasks, [dep('d1', 'A', 'B', 'SS', 1)], '2026-07-01', holidays)
    expect(ss1.byId.get('B')?.forecastStart).toBe('2026-07-20')
  })

  it('주말 시작 계획은 다음 영업일로 정규화하고 영업일 없는 기간은 제외한다', () => {
    const result = computeDependencySchedule([
      task('A', '2026-07-18', '2026-07-21'), // 토~화: 월/화 2영업일
      task('B', '2026-07-18', '2026-07-19'), // 주말만
    ], [], '2026-07-01')
    expect(result.byId.get('A')?.forecastStart).toBe('2026-07-20')
    expect(result.byId.get('A')?.forecastEnd).toBe('2026-07-21')
    expect(result.unscheduledTaskIds.has('B')).toBe(true)
    expect(result.byId.has('B')).toBe(false)
  })

  it('여러 선행 중 늦은 제약을 선택하고 계획 여유가 있으면 선행은 비크리티컬이다', () => {
    const tasks = [
      task('A', '2026-07-13', '2026-07-15'),
      task('X', '2026-07-13', '2026-07-16'),
      task('B', '2026-07-20', '2026-07-21'),
    ]
    const result = computeDependencySchedule(tasks, [dep('ab', 'A', 'B'), dep('xb', 'X', 'B')], '2026-07-01')
    expect(result.byId.get('B')?.forecastStart).toBe('2026-07-20')
    expect(result.byId.get('B')?.drivenBy).toEqual([]) // 계획 시작 하한이 더 늦다
    expect(result.byId.get('A')?.critical).toBe(false)
    expect(result.byId.get('B')?.critical).toBe(true)
    expect(result.criticalDependencyIds.size).toBe(0)
  })

  it('연속 FS 경로를 CPM 크리티컬 패스로 표시한다', () => {
    const tasks = [
      task('A', '2026-07-13', '2026-07-15'),
      task('B', '2026-07-16', '2026-07-17'),
      task('C', '2026-07-13', '2026-07-13'), // 연결 없는 요약/작업은 CP 판정 대상 아님
    ]
    const result = computeDependencySchedule(tasks, [dep('ab', 'A', 'B')], '2026-07-01')
    expect(result.criticalTaskIds).toEqual(new Set(['A', 'B']))
    expect(result.criticalDependencyIds).toEqual(new Set(['ab']))
    expect(result.byId.get('C')?.critical).toBe(false)
  })

  it('SS에서는 종단이 아닌 장기 선행의 종료를 프로젝트 종료로 사용한다', () => {
    const tasks = [task('A', '2026-07-13', '2026-07-24'), task('B', '2026-07-13', '2026-07-13')]
    const result = computeDependencySchedule(tasks, [dep('ss', 'A', 'B', 'SS')], '2026-07-01')
    expect(result.projectForecastEnd).toBe('2026-07-24')
    expect(result.byId.get('A')?.critical).toBe(true)
    expect(result.byId.get('B')?.critical).toBe(false)
  })

  it('실적 잔여기간을 예상 종료와 FS 후속 작업에 전파한다', () => {
    const tasks = [
      task('A', '2026-07-13', '2026-07-17', 40), // 5일 중 3일 잔여
      task('B', '2026-07-20', '2026-07-21', 0),
    ]
    const result = computeDependencySchedule(tasks, [dep('ab', 'A', 'B')], '2026-07-15')
    expect(result.byId.get('A')?.forecastEnd).toBe('2026-07-20') // 목·금·월
    expect(result.byId.get('A')?.forecastConfidence).toBe('estimated')
    expect(result.byId.get('B')?.forecastStart).toBe('2026-07-21')
  })

  it('순환 SCC와 그 후손을 낙관 계산하지 않고 독립 작업은 유지한다', () => {
    const tasks = ['A', 'B', 'C', 'D', 'E'].map(id => task(id, '2026-07-13', '2026-07-14'))
    const result = computeDependencySchedule(tasks, [
      dep('ab', 'A', 'B'), dep('bc', 'B', 'C'), dep('ca', 'C', 'A'), dep('cd', 'C', 'D'),
    ], '2026-07-01')
    expect(result.cycleTaskIds).toEqual(new Set(['A', 'B', 'C']))
    expect(result.blockedTaskIds).toEqual(new Set(['D']))
    expect(result.byId.has('D')).toBe(false)
    expect(result.byId.has('E')).toBe(true)
  })

  it('누락·역전 날짜, dangling endpoint, 자기 연결을 진단하고 무시한다', () => {
    const tasks = [
      task('A', null, null),
      task('B', '2026-07-15', '2026-07-14'),
      task('C', '2026-07-13', '2026-07-14'),
    ]
    const result = computeDependencySchedule(tasks, [
      dep('ac', 'A', 'C'), dep('bc', 'B', 'C'), dep('cc', 'C', 'C'), dep('ghost', 'ghost', 'C'),
    ], '2026-07-01')
    expect(result.unscheduledTaskIds).toEqual(new Set(['A', 'B']))
    expect(result.invalidDependencyIds).toEqual(new Set(['ac', 'bc', 'cc', 'ghost']))
    expect(result.criticalTaskIds.size).toBe(0)
  })
})
