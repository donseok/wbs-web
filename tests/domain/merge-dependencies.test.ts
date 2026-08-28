import { describe, it, expect } from 'vitest'
import { mergeSpecDepends, type SpecDependSource } from '@/lib/domain/mergeDependencies'
import type { TaskDependency } from '@/lib/domain/types'

const P = 'proj-1'

function item(id: string, externalRef: string | null, depends: string[] | null): SpecDependSource {
  return { id, projectId: P, externalRef, depends }
}

function row(over: Partial<TaskDependency> = {}): TaskDependency {
  return {
    id: 'row-1', projectId: P, predecessorId: 'a', successorId: 'b',
    type: 'FS', lagDays: 0, origin: 'manual', ...over,
  }
}

describe('mergeSpecDepends', () => {
  it('해석되는 ref 는 FS·lag0·origin=spec 의존성으로 합성한다', () => {
    const { dependencies, unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('a', 'mod/one', null),
      item('b', 'mod/two', ['mod/one']),
    ])

    expect(dependencies).toEqual([
      { id: 'spec:a>b', projectId: P, predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0, origin: 'spec' },
    ])
    expect(unresolvedBySuccessorId.size).toBe(0)
  })

  it('실제 행은 그대로 통과시키고 합성 행 앞에 둔다', () => {
    const manual = row({ id: 'row-x', predecessorId: 'c', successorId: 'b', type: 'SS', lagDays: 3 })
    const { dependencies } = mergeSpecDepends([manual], [
      item('a', 'mod/one', null),
      item('b', 'mod/two', ['mod/one']),
      item('c', 'mod/three', null),
    ])

    expect(dependencies[0]).toEqual(manual)
    expect(dependencies).toHaveLength(2)
    expect(dependencies[1].origin).toBe('spec')
  })

  it('같은 (선행, 후행) 쌍이 양쪽에 있으면 실제 행이 이긴다 — 연결선이 겹치지 않는다', () => {
    const manual = row({ id: 'row-x', predecessorId: 'a', successorId: 'b', type: 'SS', lagDays: 5 })
    const { dependencies } = mergeSpecDepends([manual], [
      item('a', 'mod/one', null),
      item('b', 'mod/two', ['mod/one']),
    ])

    expect(dependencies).toEqual([manual]) // 합성 행은 버려진다. SS·lag5 가 살아남는다.
  })

  it('해석 못 한 ref 는 버리지 않고 unresolvedBySuccessorId 로 넘긴다', () => {
    // claim 게이트는 없는 ref 를 미충족으로 세어 409 를 낸다(depends.ts:47, claim/route.ts:66).
    // 여기서 버리면 화면이 "선행 없음 → 시작 가능"으로 위장한다.
    const { dependencies, unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('b', 'mod/two', ['mod/gone', 'mod/also-gone']),
    ])

    expect(dependencies).toEqual([])
    expect(unresolvedBySuccessorId.get('b')).toEqual(['mod/gone', 'mod/also-gone'])
  })

  it('해석된 ref 와 못 한 ref 가 섞이면 각각 제 자리로 간다', () => {
    const { dependencies, unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('a', 'mod/one', null),
      item('b', 'mod/two', ['mod/one', 'mod/gone']),
    ])

    expect(dependencies.map(d => d.predecessorId)).toEqual(['a'])
    expect(unresolvedBySuccessorId.get('b')).toEqual(['mod/gone'])
  })

  it('자기참조는 버린다 — 미해석으로도 세지 않는다', () => {
    const { dependencies, unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('a', 'mod/one', ['mod/one']),
    ])

    expect(dependencies).toEqual([])
    expect(unresolvedBySuccessorId.size).toBe(0)
  })

  it('순환은 버리지 않는다 — computeDependencySchedule 이 cycleTaskIds 로 처리한다', () => {
    const { dependencies } = mergeSpecDepends([], [
      item('a', 'mod/one', ['mod/two']),
      item('b', 'mod/two', ['mod/one']),
    ])

    expect(dependencies).toHaveLength(2)
    expect(dependencies.map(d => d.id).sort()).toEqual(['spec:a>b', 'spec:b>a'])
  })

  it('external_ref 가 없는 항목은 선행으로 해석되지 않는다', () => {
    const { dependencies, unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('a', null, null),
      item('b', 'mod/two', ['mod/one']),
    ])

    expect(dependencies).toEqual([])
    expect(unresolvedBySuccessorId.get('b')).toEqual(['mod/one'])
  })

  it('합성 행의 projectId 는 후행 항목의 것을 쓴다 — AI 봇 스코프 검사 대상', () => {
    // ai/tools/wbs.ts:104 의 every(d => d.projectId === projectId) 가 어긋나면
    // 성능 저하가 아니라 봇 응답 전체가 repositoryScopeViolation() 으로 죽는다.
    const { dependencies } = mergeSpecDepends([], [
      { id: 'a', projectId: P, externalRef: 'mod/one', depends: null },
      { id: 'b', projectId: P, externalRef: 'mod/two', depends: ['mod/one'] },
    ])

    expect(dependencies.every(d => d.projectId === P)).toBe(true)
  })

  it('depends 가 없거나 빈 배열이면 아무것도 만들지 않는다', () => {
    const { dependencies, unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('a', 'mod/one', null),
      item('b', 'mod/two', []),
    ])

    expect(dependencies).toEqual([])
    expect(unresolvedBySuccessorId.size).toBe(0)
  })

  it('같은 ref 가 depends 에 두 번 있어도 합성은 한 번만 한다', () => {
    const { dependencies } = mergeSpecDepends([], [
      item('a', 'mod/one', null),
      item('b', 'mod/two', ['mod/one', 'mod/one']),
    ])

    expect(dependencies).toHaveLength(1)
  })

  it('같은 미해석 ref 가 두 번 있어도 한 번만 보고한다', () => {
    const { unresolvedBySuccessorId } = mergeSpecDepends([], [
      item('b', 'mod/two', ['mod/gone', 'mod/gone']),
    ])

    expect(unresolvedBySuccessorId.get('b')).toEqual(['mod/gone'])
  })
})
