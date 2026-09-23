// 강제 진행(스펙 2026-09-23 F2) — 간트 합성 링크와 착수 판정이 면제 간선을 충족으로 본다.
import { describe, expect, it } from 'vitest'
import { mergeSpecDepends } from '@/lib/domain/mergeDependencies'
import { evaluateStartReadiness } from '@/lib/domain/dependencyReadiness'

describe('mergeSpecDepends — dependsWaived', () => {
  const items = [
    { id: 'a', projectId: 'p', externalRef: 'm/TSK-01', depends: null },
    { id: 'b', projectId: 'p', externalRef: 'm/TSK-02', depends: ['m/TSK-01', 'm/GONE'], dependsWaived: ['m/TSK-01', 'm/GONE'] },
  ]
  it('면제된 간선의 합성 링크에 waived:true 를 싣는다', () => {
    const { dependencies } = mergeSpecDepends([], items)
    expect(dependencies).toEqual([expect.objectContaining({ predecessorId: 'a', successorId: 'b', origin: 'spec', waived: true })])
  })
  it('면제된 미해석 ref 는 unresolved 로 세지 않는다', () => {
    expect(mergeSpecDepends([], items).unresolvedBySuccessorId.get('b')).toBeUndefined()
  })
  it('착수 판정은 면제 링크를 충족으로 본다', () => {
    const { dependencies } = mergeSpecDepends([], items)
    const r = evaluateStartReadiness(
      { id: 'b', rolledActualPct: 0, stage: null }, dependencies,
      new Map([['a', { id: 'a', rolledActualPct: 10, stage: 'ip' }]]),
    )
    expect(r.ready).toBe(true)
    expect(r.waitingCount).toBe(0)
  })
  it('면제 링크의 선행 행이 없어도 unknown 이 아니라 충족이다', () => {
    const { dependencies } = mergeSpecDepends([], items)
    const r = evaluateStartReadiness({ id: 'b', rolledActualPct: 0, stage: null }, dependencies, new Map())
    expect(r.unknownCount).toBe(0)
    expect(r.ready).toBe(true)
  })
})
