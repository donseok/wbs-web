import { describe, it, expect } from 'vitest'
import { plannedPct, achievementOf, statusOf } from '@/lib/domain/progress'
import { buildTree, collectLeaves, type BuildTreeOpts } from '@/lib/domain/tree'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import { DEFAULT_TEAM_CODES, teamOrderMap } from '@/lib/domain/teams'

const H = new Set<string>()
const OPTS: BuildTreeOpts = { subActTeamOrder: teamOrderMap(DEFAULT_TEAM_CODES) }
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, level: 'activity', code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
})

describe('plannedPct edge cases', () => {
  it('start/end가 모두 주말이면 총 영업일 0 → 0%', () => {
    expect(plannedPct('2026-07-04', '2026-07-05', '2026-07-10', H)).toBe(0) // 토~일
  })
  it('start만 있고 end 없으면 0', () => {
    expect(plannedPct('2026-07-06', null, '2026-07-10', H)).toBe(0)
  })
})

describe('statusOf edge cases', () => {
  it('actual 100이면 시작 전이라도 done', () => {
    expect(statusOf(100, 0, '2026-08-01', '2026-07-01')).toBe('done')
  })
  it('start null이고 계획·실적 0이면 not_started', () => {
    expect(statusOf(0, 0, null, '2026-07-10')).toBe('not_started')
  })
  it('계획>0, 실적 0, 시작 도래 → delayed', () => {
    expect(statusOf(0, 40, '2026-07-01', '2026-07-10')).toBe('delayed')
  })
  it('실적==계획(>0) → in_progress', () => {
    expect(statusOf(60, 60, '2026-07-01', '2026-07-10')).toBe('in_progress')
  })
  it('시작 전이라도 실적>0이면 in_progress', () => {
    expect(statusOf(50, 0, '2026-07-13', '2026-07-02')).toBe('in_progress')
  })
  it('시작 전 + 실적 0이면 not_started 유지', () => {
    expect(statusOf(0, 0, '2026-07-13', '2026-07-02')).toBe('not_started')
  })
  it('시작 전 + 실적 100이면 done', () => {
    expect(statusOf(100, 0, '2026-07-13', '2026-07-02')).toBe('done')
  })
  it('시작 전 롤업 부모(자식 계획>실적>0)는 delayed — 자식이 이미 시작했으면 부모도 지연 노출', () => {
    // 롤업 부모는 rolledPlanned가 자식 가중평균이라 미래 시작이어도 planned>0일 수 있다.
    expect(statusOf(20, 60, '2026-08-01', '2026-07-02')).toBe('delayed')
  })
})

describe('achievementOf edge cases', () => {
  it('계획 0이면 null', () => { expect(achievementOf(50, 0)).toBeNull() })
  it('반올림', () => { expect(achievementOf(1, 3)).toBe(33) })
})

describe('buildTree edge cases', () => {
  it('부모가 없는 parentId는 루트로 승격', () => {
    const tree = buildTree([row({ id: 'a', parentId: 'ghost', sortOrder: 1 })], OPTS)
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('a')
  })
  it('여러 루트는 sortOrder로 정렬', () => {
    const tree = buildTree([
      row({ id: 'b', parentId: null, sortOrder: 2 }),
      row({ id: 'a', parentId: null, sortOrder: 1 }),
    ], OPTS)
    expect(tree.map(t => t.id)).toEqual(['a', 'b'])
  })
})

describe('computeTree multi-level rollup', () => {
  const rows: WbsRow[] = [
    row({ id: 'P', parentId: null, level: 'phase', code: '1', sortOrder: 0 }),
    row({ id: 'T', parentId: 'P', level: 'task', code: '1-1', sortOrder: 1 }),
    row({ id: 'A1', parentId: 'T', level: 'activity', sortOrder: 2, plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 100 }),
    row({ id: 'A2', parentId: 'T', level: 'activity', sortOrder: 3, plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 0 }),
  ]
  const tree = computeTree(rows, '2026-07-20', H, OPTS) // 기간 종료 후

  it('Phase는 자식(Task)의 롤업을 그대로 받는다', () => {
    const p = tree[0]
    expect(p.rolledActualPct).toBe(50) // (100+0)/2
    expect(p.plannedPct).toBe(100) // 기간 종료 → 100
  })
  it('상위 노드의 achievement·status 계산', () => {
    const p = tree[0]
    expect(p.achievement).toBe(50) // 50/100
    expect(p.status).toBe('delayed') // 실적 50 < 계획 100
  })
})

/* 4단+ 깊이 회귀 감시(스펙 §4.5). tests/excel/{parse,export,edgecases}.test.ts 는 Phase/Task/Activity
 * 3열 고정 양식(Plan B 이전)이라 파서 입력 자체로 4단을 표현할 방법이 없다 — 그 세 파일이 검증하는
 * "파싱된 값이 흘러가는" 도메인 통과 지점(buildTree→computeTree)의 4단 케이스를 여기 둔다.
 * 형제 깊이가 혼재해도(한쪽은 4단, 한쪽은 3단) 롤업·리프 판정이 children.length 만으로 동작함을 고정 —
 * 3단 가정(예: "리프는 항상 2단 아래"처럼 깊이를 하드코딩)이 되살아나면 여기서 무너진다. */
describe('computeTree 4단+ 롤업 — 엑셀 3열 양식 밖(도메인 통과 지점, 혼재 깊이)', () => {
  const rows: WbsRow[] = [
    row({ id: 'P', parentId: null, level: 'phase', code: '1', sortOrder: 0 }),
    // 왼쪽 가지: Phase→Task→(엑셀엔 없는 4번째 실 레벨 'subtask')→Activity×2 — 깊이 4
    row({ id: 'T1', parentId: 'P', level: 'task', code: '1-1', sortOrder: 0 }),
    row({ id: 'ST1', parentId: 'T1', level: 'subtask', code: '1-1-1', sortOrder: 0 }),
    row({
      id: 'A1', parentId: 'ST1', level: 'activity', sortOrder: 0,
      plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 100, weight: 3,
    }),
    row({
      id: 'A2', parentId: 'ST1', level: 'activity', sortOrder: 1,
      plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 0, weight: 1,
    }),
    // 오른쪽 가지: Phase→Task→Activity — 깊이 3(형제 T2 가 T1 보다 한 단 얕다)
    row({ id: 'T2', parentId: 'P', level: 'task', code: '1-2', sortOrder: 1, weight: 1 }),
    row({
      id: 'A3', parentId: 'T2', level: 'activity', sortOrder: 0,
      plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 50,
    }),
  ]
  const tree = computeTree(rows, '2026-07-20', H, OPTS) // 기간 종료 후(기존 스위트와 동일 today)

  it('리프(자식 없음)만 collectLeaves 에 잡힌다 — 중간 계층(ST1 포함) 제외, 문서 순서 보존', () => {
    expect(collectLeaves(tree).map(l => l.id)).toEqual(['A1', 'A2', 'A3'])
  })
  it('4단 가지의 가중 롤업이 3단 위로 정확히 전파된다', () => {
    const st1 = tree[0].children[0].children[0]
    expect(st1.id).toBe('ST1')
    expect(st1.rolledActualPct).toBe(75) // (100*3+0*1)/4
    const t1 = tree[0].children[0]
    expect(t1.rolledActualPct).toBe(75) // 외동 자식 통과
  })
  it('깊이가 다른 형제 가지(4단 vs 3단)가 공통 조상에서 올바르게 합산된다', () => {
    const p = tree[0]
    // T1(75, weight null→1) · T2(50, weight 1) → (75*1+50*1)/2
    expect(p.rolledActualPct).toBe(62.5)
    expect(p.achievement).toBe(63)
    expect(p.status).toBe('delayed')
  })
})
