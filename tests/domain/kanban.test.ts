import { describe, it, expect } from 'vitest'
import type { ComputedItem, OwnerKind, Status, TeamCode } from '@/lib/domain/types'
import { groupByPhase, groupByOwner, groupByStatus, groupByProgress, bucketOf, leafPaths, dueSignal, lensCards, applyQuickFilters, sortCards } from '@/lib/domain/kanban'

type Owner = { team: TeamCode; kind: OwnerKind }

function node(
  id: string,
  opts: {
    name?: string
    status?: Status
    owners?: Owner[]
    children?: ComputedItem[]
    actualPct?: number | null
    rolledActualPct?: number
    plannedStart?: string | null
    plannedEnd?: string | null
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
    plannedStart: opts.plannedStart ?? '2026-09-01',
    plannedEnd: opts.plannedEnd ?? '2026-09-30',
    weight: null,
    actualPct: opts.actualPct ?? (children.length ? null : 0),
    owners: opts.owners ?? [],
    isOwnerSplit: false,
    plannedPct: 0,
    rolledActualPct: opts.rolledActualPct ?? 0,
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
  it('PMO/가공/ERP/MES/MDM + 미배정 6개 컬럼을 순서대로 만든다', () => {
    const cols = groupByOwner(fixture())
    expect(cols.map(c => c.key)).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM', '미배정'])
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

describe('bucketOf', () => {
  it('0·null·음수는 시작전, 100 이상은 완료, 그 사이는 진행중', () => {
    expect(bucketOf(0)).toBe('not_started')
    expect(bucketOf(null)).toBe('not_started')
    expect(bucketOf(-5)).toBe('not_started')
    expect(bucketOf(1)).toBe('in_progress')
    expect(bucketOf(99)).toBe('in_progress')
    expect(bucketOf(100)).toBe('done')
    expect(bucketOf(120)).toBe('done')
  })
})

describe('groupByProgress', () => {
  it('시작전/진행중/완료 3컬럼을 rolledActualPct 기준으로 분류한다', () => {
    const items = [
      node('P', { children: [
        node('L0', { rolledActualPct: 0 }),
        node('L45', { rolledActualPct: 45 }),
        node('L100', { rolledActualPct: 100 }),
      ] }),
    ]
    const cols = groupByProgress(items)
    expect(cols.map(c => c.key)).toEqual(['not_started', 'in_progress', 'done'])
    expect(cols.map(c => c.title)).toEqual(['시작전', '진행중', '완료'])
    const by = (k: string) => cols.find(c => c.key === k)!
    expect(by('not_started').cards.map(c => c.id)).toEqual(['L0'])
    expect(by('in_progress').cards.map(c => c.id)).toEqual(['L45'])
    expect(by('done').cards.map(c => c.id)).toEqual(['L100'])
    expect(cols.reduce((n, c) => n + c.count, 0)).toBe(3)
  })
})

describe('leafPaths', () => {
  it('리프마다 루트→부모 이름 경로를 만든다', () => {
    const items = [
      node('A', { name: '준비', children: [
        node('A1', { name: '설계', children: [ node('L', { name: '리프' }) ] }),
      ] }),
    ]
    const m = leafPaths(items)
    expect(m.get('L')).toEqual(['준비', '설계'])
    expect(m.has('A')).toBe(false) // 중간 노드는 키 아님
  })
})

describe('dueSignal', () => {
  const today = '2026-07-25'
  it('완료(100%)는 신호 없음', () => {
    expect(dueSignal('2026-07-01', 100, today)).toBeNull()
  })
  it('기한 경과+미완은 overdue(경과 일수)', () => {
    expect(dueSignal('2026-07-20', 40, today)).toEqual({ kind: 'overdue', days: 5 })
  })
  it('기한 이전은 due(남은 일수), 당일은 0', () => {
    expect(dueSignal('2026-07-28', 40, today)).toEqual({ kind: 'due', days: 3 })
    expect(dueSignal('2026-07-25', 0, today)).toEqual({ kind: 'due', days: 0 })
  })
  it('plannedEnd 없으면 null', () => {
    expect(dueSignal(null, 40, today)).toBeNull()
  })
})

describe('lensCards', () => {
  it("myTeam은 내 팀이 담당(primary/support)인 리프만, all은 전체", () => {
    const leaves = [
      node('a', { owners: [{ team: 'PMO', kind: 'primary' }] }),
      node('b', { owners: [{ team: 'ERP', kind: 'support' }] }),
    ]
    expect(lensCards(leaves, 'myTeam', 'ERP').map(c => c.id)).toEqual(['b'])
    expect(lensCards(leaves, 'all', 'ERP').map(c => c.id)).toEqual(['a', 'b'])
    expect(lensCards(leaves, 'myTeam', null).map(c => c.id)).toEqual(['a', 'b']) // 팀 미상이면 전체
  })
})

describe('applyQuickFilters', () => {
  const today = '2026-07-25'
  const leaves = [
    node('over', { status: 'delayed', rolledActualPct: 30, plannedEnd: '2026-07-20' }),
    node('soon', { status: 'in_progress', rolledActualPct: 30, plannedEnd: '2026-07-28' }),
    node('far', { status: 'in_progress', rolledActualPct: 30, plannedEnd: '2026-09-01' }),
    node('ns', { status: 'not_started', rolledActualPct: 0, plannedEnd: '2026-08-01' }),
  ]
  const off = { overdue: false, dueThisWeek: false, inProgress: false, notStarted: false }
  it('아무것도 안 켜면 전부', () => {
    expect(applyQuickFilters(leaves, off, today).length).toBe(4)
  })
  it('overdue=지연 status만', () => {
    expect(applyQuickFilters(leaves, { ...off, overdue: true }, today).map(c => c.id)).toEqual(['over'])
  })
  it('dueThisWeek=오늘~+6일 마감', () => {
    expect(applyQuickFilters(leaves, { ...off, dueThisWeek: true }, today).map(c => c.id)).toEqual(['soon'])
    // over(-5)는 범위 밖(<0)이므로 제외되는지 확인: over의 plannedEnd 2026-07-20 < today → dueThisWeek 제외
  })
  it('notStarted=버킷 시작전만', () => {
    expect(applyQuickFilters(leaves, { ...off, notStarted: true }, today).map(c => c.id)).toEqual(['ns'])
  })
  it('inProgress+notStarted=합집합(배타 버킷이라 AND면 항상 0건)', () => {
    const ids = applyQuickFilters(leaves, { ...off, inProgress: true, notStarted: true }, today).map(c => c.id)
    expect(ids).toEqual(['over', 'soon', 'far', 'ns'])
  })
  it('완료(100%)는 진행중+미착수 합집합에서 빠진다', () => {
    const withDone = [...leaves, node('done', { status: 'done', rolledActualPct: 100, plannedEnd: '2026-07-10' })]
    const ids = applyQuickFilters(withDone, { ...off, inProgress: true, notStarted: true }, today).map(c => c.id)
    expect(ids).not.toContain('done')
  })
  it('다른 갈래끼리는 AND — 지연 + (진행중∪미착수)', () => {
    const ids = applyQuickFilters(leaves, { ...off, overdue: true, inProgress: true, notStarted: true }, today).map(c => c.id)
    expect(ids).toEqual(['over'])
  })
})

describe('sortCards', () => {
  it('지연 우선 → 계획종료 오름차순 → 이름', () => {
    const cards = [
      node('c', { name: '가', status: 'in_progress', plannedEnd: '2026-08-10' }),
      node('a', { name: '나', status: 'delayed', plannedEnd: '2026-08-20' }),
      node('b', { name: '다', status: 'in_progress', plannedEnd: '2026-08-05' }),
    ]
    expect(sortCards(cards, '2026-07-25').map(c => c.id)).toEqual(['a', 'b', 'c'])
  })
})
