import { describe, expect, it } from 'vitest'
import { evaluateStartReadiness, type ReadinessLink, type ReadinessTask } from '@/lib/domain/dependencyReadiness'

const task = (id: string, pct: number, stage: string | null = null): ReadinessTask =>
  ({ id, rolledActualPct: pct, stage })
const link = (id: string, predecessorId: string, type: 'FS' | 'SS' = 'FS', lagDays = 0): ReadinessLink =>
  ({ id, predecessorId, type, lagDays, origin: 'manual' })
const specLink = (id: string, predecessorId: string): ReadinessLink =>
  ({ id, predecessorId, type: 'FS', lagDays: 0, origin: 'spec' })

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

  describe('origin 별 충족 규칙', () => {
    // spec 축은 에이전트 claim 게이트가 실제로 막는 축이라 게이트와 같은 식(stage >= im)을 써야 한다.
    // 실적으로 판정하면 화면은 "시작 가능"인데 claim 이 409 를 내는 어긋남이 생긴다.
    it('spec 링크는 실적이 아니라 stage 로 판정한다 — 실적 100% 여도 stage 미달이면 대기', () => {
      const index = new Map([['p', task('p', 100, 'ip')]])
      const r = evaluateStartReadiness(task('t', 0), [specLink('s1', 'p')], index)
      expect(r.byDependencyId.get('s1')).toBe('waiting')
      expect(r.ready).toBe(false)
    })

    it('spec 링크는 stage 가 im 이면 실적 0 이어도 충족', () => {
      const index = new Map([['p', task('p', 0, 'im')]])
      const r = evaluateStartReadiness(task('t', 0), [specLink('s1', 'p')], index)
      expect(r.byDependencyId.get('s1')).toBe('satisfied')
      expect(r.ready).toBe(true)
    })

    it('spec 링크는 stage 가 xx(완료)여도 충족', () => {
      const index = new Map([['p', task('p', 0, 'xx')]])
      const r = evaluateStartReadiness(task('t', 0), [specLink('s1', 'p')], index)
      expect(r.byDependencyId.get('s1')).toBe('satisfied')
    })

    it('spec 링크의 stage 가 없으면 대기 — 모르면 시작 가능으로 위장하지 않는다', () => {
      const index = new Map([['p', task('p', 100, null)]])
      const r = evaluateStartReadiness(task('t', 0), [specLink('s1', 'p')], index)
      expect(r.byDependencyId.get('s1')).toBe('waiting')
    })

    it('manual 링크는 종전대로 실적으로 판정한다 — stage 가 im 이어도 실적 미달이면 대기', () => {
      const index = new Map([['p', task('p', 40, 'im')]])
      const r = evaluateStartReadiness(task('t', 0), [link('d1', 'p')], index)
      expect(r.byDependencyId.get('d1')).toBe('waiting')
    })

    it('두 축이 섞이면 각자의 규칙으로 따로 판정한다', () => {
      const index = new Map([
        ['a', task('a', 100, null)],  // manual: 충족
        ['b', task('b', 0, 'im')],    // spec: 충족
      ])
      const r = evaluateStartReadiness(task('t', 0), [link('d1', 'a'), specLink('s1', 'b')], index)
      expect(r.byDependencyId.get('d1')).toBe('satisfied')
      expect(r.byDependencyId.get('s1')).toBe('satisfied')
      expect(r.ready).toBe(true)
    })
  })

  describe('해석 못 한 선행 ref', () => {
    // loadDependsInfo 가 없는 ref 를 stage:null 로 돌려주고 claim 라우트가 그것을 unmet 으로 센다.
    // 화면이 이 상태를 빼면 실제로 막힌 작업이 "시작 가능"으로 보인다.
    it('미해석 ref 는 unknown 으로 세고 ready 를 막는다', () => {
      const r = evaluateStartReadiness(task('t', 0), [], new Map(), ['mod/gone'])
      expect(r.unknownCount).toBe(1)
      expect(r.ready).toBe(false)
    })

    it('미해석 ref 는 충족된 선행이 있어도 ready 를 막는다', () => {
      const index = new Map([['p', task('p', 100)]])
      const r = evaluateStartReadiness(task('t', 0), [link('d1', 'p')], index, ['mod/gone'])
      expect(r.waitingCount).toBe(0)
      expect(r.unknownCount).toBe(1)
      expect(r.ready).toBe(false)
    })

    it('미해석 ref 가 없으면 종전과 같다', () => {
      const r = evaluateStartReadiness(task('t', 0), [], new Map(), [])
      expect(r.unknownCount).toBe(0)
      expect(r.ready).toBe(true)
    })
  })
})
