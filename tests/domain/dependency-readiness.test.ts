import { describe, expect, it } from 'vitest'
import { evaluateStartReadiness, type ReadinessLink, type ReadinessTask } from '@/lib/domain/dependencyReadiness'

const task = (id: string, pct: number): ReadinessTask => ({ id, rolledActualPct: pct })
const link = (id: string, predecessorId: string, type: 'FS' | 'SS' = 'FS', lagDays = 0): ReadinessLink =>
  ({ id, predecessorId, type, lagDays })

describe('evaluateStartReadiness', () => {
  it('선행이 없으면 즉시 시작 가능', () => {
    const r = evaluateStartReadiness(task('t', 0), [], new Map())
    expect(r.ready).toBe(true)
    expect(r.waitingCount).toBe(0)
    expect(r.started).toBe(false)
  })

  it('FS 는 선행이 100% 여야 충족 — 99.5% 는 아직 대기', () => {
    const index = new Map([['p', task('p', 99.5)]])
    const r = evaluateStartReadiness(task('t', 0), [link('d1', 'p')], index)
    expect(r.byDependencyId.get('d1')).toBe('waiting')
    expect(r.ready).toBe(false)
    expect(r.waitingCount).toBe(1)
  })

  it('FS 는 선행 실적 100% 에서 충족', () => {
    const index = new Map([['p', task('p', 100)]])
    const r = evaluateStartReadiness(task('t', 0), [link('d1', 'p')], index)
    expect(r.byDependencyId.get('d1')).toBe('satisfied')
    expect(r.ready).toBe(true)
  })

  it('SS 는 선행이 시작만 하면 충족(실적 > 0)', () => {
    const index = new Map([['p', task('p', 10)]])
    const r = evaluateStartReadiness(task('t', 0), [link('d1', 'p', 'SS')], index)
    expect(r.byDependencyId.get('d1')).toBe('satisfied')
    expect(r.ready).toBe(true)
  })

  it('SS 도 선행 실적 0 이면 대기 — 지연 상태여도 시작한 것이 아니다', () => {
    const index = new Map([['p', task('p', 0)]])
    const r = evaluateStartReadiness(task('t', 0), [link('d1', 'p', 'SS')], index)
    expect(r.byDependencyId.get('d1')).toBe('waiting')
    expect(r.ready).toBe(false)
  })

  it('선행 작업을 찾을 수 없으면 unknown 이고 fail-closed', () => {
    const r = evaluateStartReadiness(task('t', 0), [link('d1', 'ghost')], new Map())
    expect(r.byDependencyId.get('d1')).toBe('unknown')
    expect(r.unknownCount).toBe(1)
    expect(r.waitingCount).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('여러 선행 중 하나만 미충족이어도 시작 불가', () => {
    const index = new Map([['a', task('a', 100)], ['b', task('b', 40)]])
    const r = evaluateStartReadiness(task('t', 0), [link('d1', 'a'), link('d2', 'b')], index)
    expect(r.byDependencyId.get('d1')).toBe('satisfied')
    expect(r.byDependencyId.get('d2')).toBe('waiting')
    expect(r.ready).toBe(false)
    expect(r.waitingCount).toBe(1)
  })

  it('대상이 이미 시작했으면 started — 선행 미충족이면 ready 는 그대로 false', () => {
    const index = new Map([['p', task('p', 0)]])
    const r = evaluateStartReadiness(task('t', 30), [link('d1', 'p')], index)
    expect(r.started).toBe(true)
    expect(r.ready).toBe(false)
  })
})
