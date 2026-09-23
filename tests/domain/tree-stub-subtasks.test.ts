// 스텁 제거 하위 Task 는 구조에 투명하다(스펙 2026-09-23 F9) — children 이 아니라 subTasks 로 가고, 롤업·리프 판정에 들어가지 않는다.
import { describe, expect, it } from 'vitest'
import { buildTree, collectLeaves } from '@/lib/domain/tree'
import { computeTree } from '@/lib/domain/rollup'
import { computeCompletionMap } from '@/lib/domain/project-status'
import { treeMaxDepth } from '@/lib/domain/levelSettings'
import { applyWbsChange } from '@/lib/domain/wbsRealtime'
import type { WbsRow } from '@/lib/domain/types'

const row = (id: string, parentId: string | null, over: Partial<WbsRow> = {}): WbsRow => ({
  id, parentId, code: id, sortOrder: 1, name: id, biz: null, deliverable: null,
  plannedStart: '2026-09-01', plannedEnd: '2026-09-30', weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over,
})
const opts = { subActTeamOrder: new Map<string, number>() }
const rows = [
  row('wp', null),
  row('succ', 'wp', { actualPct: 80, stage: 'im' }),
  row('sub', 'succ', { actualPct: 30, stage: 'ip', stubFor: 'm/TSK-01' }),
  row('other', 'wp', { actualPct: 20 }),
]

describe('buildTree — stub 하위 분리', () => {
  it('stub 하위는 children 이 아니라 subTasks 에 들어간다', () => {
    const [wp] = buildTree(rows, opts)
    const succ = wp.children.find(c => c.id === 'succ')!
    expect(succ.children).toEqual([])
    expect(succ.subTasks!.map(s => s.id)).toEqual(['sub'])
    expect(succ.subTasks![0].depth).toBe(succ.depth + 1)
  })
  it('후행은 여전히 리프이고 롤업은 후행 자기 실적(80)을 쓴다', () => {
    const [wp] = computeTree(rows, '2026-09-15', new Set(), opts)
    const succ = wp.children.find(c => c.id === 'succ')!
    expect(succ.rolledActualPct).toBe(80)
    expect(wp.rolledActualPct).toBe(50) // (80 + 20) / 2 — 하위 30 은 들어가지 않는다
    expect(collectLeaves([wp]).map(l => l.id)).toEqual(['succ', 'other'])
    expect(succ.subTasks![0].rolledActualPct).toBe(30) // 하위 자신은 계산된다(표시용)
  })
  it('실시간 패치는 subTasks 안의 하위도 찾아 바꾸고, 후행 롤업은 그대로다', () => {
    const tree = computeTree(rows, '2026-09-15', new Set(), opts)
    const next = applyWbsChange(tree, { id: 'sub', projectId: 'p', stage: 'xx', actualPct: 100, updatedAt: '2026-09-23T00:00:00Z' }, { today: '2026-09-15', holidays: new Set() })
    const succ = next![0].children.find(c => c.id === 'succ')!
    expect(succ.subTasks![0].stage).toBe('xx')
    expect(next![0].rolledActualPct).toBe(50)
  })
})

describe('raw 행 판정도 투명하다', () => {
  it('완료 배지 — stub 행은 리프 집합에서도, 부모 판정에서도 빠진다', () => {
    const m = computeCompletionMap([
      { id: 'succ', parentId: null, projectId: 'p', actualPct: 100 },
      { id: 'sub', parentId: 'succ', projectId: 'p', actualPct: 0, stubFor: 'm/TSK-01' },
    ])
    expect(m.p).toEqual({ hasWbs: true, allDone: true })
  })
  it('레벨 깊이 — stub 행은 세지 않는다', () => {
    expect(treeMaxDepth([
      { id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }, { id: 's', parent_id: 'b', stub_for: 'm/X' },
    ])).toBe(1)
  })
})
