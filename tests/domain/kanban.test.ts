import { describe, it, expect } from 'vitest'
import type { ComputedItem, OwnerKind, Status, TeamCode } from '@/lib/domain/types'
import { groupByPhase, groupByOwner, groupByStatus } from '@/lib/domain/kanban'

type Owner = { team: TeamCode; kind: OwnerKind }

function node(
  id: string,
  opts: {
    name?: string
    status?: Status
    owners?: Owner[]
    children?: ComputedItem[]
  } = {},
): ComputedItem {
  const children = opts.children ?? []
  return {
    id,
    parentId: null,
    level: children.length ? 'phase' : 'activity',
    code: id,
    sortOrder: 0,
    name: opts.name ?? id,
    biz: null,
    deliverable: null,
    plannedStart: '2026-09-01',
    plannedEnd: '2026-09-30',
    weight: null,
    actualPct: children.length ? null : 0,
    owners: opts.owners ?? [],
    plannedPct: 0,
    rolledActualPct: 0,
    achievement: null,
    status: opts.status ?? 'not_started',
    children,
  }
}

// 트리:
//  A(phase)
//   ├ A1(task)
//   │  ├ A1a(leaf) done,  primary PMO
//   │  └ A1b(leaf) in_progress, primary 가공 + support ERP
//   └ A2(leaf, task-no-child) delayed, primary PMO + primary ERP
//  B(phase)
//   └ B1(leaf) not_started, support MES only (→ 미배정)
function fixture(): ComputedItem[] {
  const a1a = node('A1a', { status: 'done', owners: [{ team: 'PMO', kind: 'primary' }] })
  const a1b = node('A1b', {
    status: 'in_progress',
    owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'support' }],
  })
  const a1 = node('A1', { children: [a1a, a1b] })
  const a2 = node('A2', {
    status: 'delayed',
    owners: [{ team: 'PMO', kind: 'primary' }, { team: 'ERP', kind: 'primary' }],
  })
  const a = node('A', { name: '준비', children: [a1, a2] })
  const b1 = node('B1', { status: 'not_started', owners: [{ team: 'MES', kind: 'support' }] })
  const b = node('B', { name: '설계', children: [b1] })
  return [a, b]
}

describe('groupByPhase', () => {
  it('최상위 phase마다 컬럼을 만들고 카드는 말단 작업만 담는다', () => {
    const cols = groupByPhase(fixture())
    expect(cols.map(c => c.title)).toEqual(['준비', '설계'])
    expect(cols[0].count).toBe(3)
    expect(cols[0].cards.map(c => c.id).sort()).toEqual(['A1a', 'A1b', 'A2'])
    expect(cols[1].count).toBe(1)
    expect(cols[1].cards.map(c => c.id)).toEqual(['B1'])
  })

  it('중간 노드(A1, A2의 부모 A)는 카드에 포함되지 않는다', () => {
    const cols = groupByPhase(fixture())
    const allCardIds = cols.flatMap(c => c.cards.map(card => card.id))
    expect(allCardIds).not.toContain('A')
    expect(allCardIds).not.toContain('A1')
  })
})

describe('groupByOwner', () => {
  it('PMO/가공/ERP/MES + 미배정 5개 컬럼을 순서대로 만든다', () => {
    const cols = groupByOwner(fixture())
    expect(cols.map(c => c.key)).toEqual(['PMO', 'ERP', 'MES', '가공', '미배정'])
  })

  it('leaf는 primary 담당팀 컬럼마다 들어가고 support는 무시한다', () => {
    const cols = groupByOwner(fixture())
    const by = (k: string) => cols.find(c => c.key === k)!
    expect(by('PMO').cards.map(c => c.id).sort()).toEqual(['A1a', 'A2'])
    expect(by('가공').cards.map(c => c.id)).toEqual(['A1b'])
    expect(by('ERP').cards.map(c => c.id)).toEqual(['A2']) // A1b의 ERP는 support → 제외
    expect(by('MES').count).toBe(0)
  })

  it('primary 담당이 없는 leaf는 미배정으로 간다', () => {
    const cols = groupByOwner(fixture())
    const unassigned = cols.find(c => c.key === '미배정')!
    expect(unassigned.cards.map(c => c.id)).toEqual(['B1'])
  })
})

describe('groupByStatus', () => {
  it('시작전/진행중/지연/완료 컬럼을 순서대로 만든다', () => {
    const cols = groupByStatus(fixture())
    expect(cols.map(c => c.key)).toEqual(['not_started', 'in_progress', 'delayed', 'done'])
    expect(cols.map(c => c.title)).toEqual(['시작전', '진행중', '지연', '완료'])
  })

  it('leaf를 status별로 분류한다', () => {
    const cols = groupByStatus(fixture())
    const by = (k: string) => cols.find(c => c.key === k)!
    expect(by('not_started').cards.map(c => c.id)).toEqual(['B1'])
    expect(by('in_progress').cards.map(c => c.id)).toEqual(['A1b'])
    expect(by('delayed').cards.map(c => c.id)).toEqual(['A2'])
    expect(by('done').cards.map(c => c.id)).toEqual(['A1a'])
    expect(cols.reduce((n, c) => n + c.count, 0)).toBe(4)
  })
})
