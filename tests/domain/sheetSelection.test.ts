import { describe, it, expect } from 'vitest'
import {
  CONTENT_COLS, rectFromAddrs, cellsInRect, valuesInRect, moveActive, advanceActive,
  pasteEdits, fillEdits, clearEdits, reconcileSelection,
  type CellAddr, type GridRect, type SelectionState,
} from '@/lib/domain/sheetSelection'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

const mkRow = (id: string, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow => ({
  id, reportId: 'rep', section: 'ERP', module: 'MM', sortOrder: 0,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})
const addr = (rowId: string, col: CellAddr['col']): CellAddr => ({ rowId, col })
const rect = (top: number, left: number, bottom: number, right: number): GridRect => ({ top, left, bottom, right })

describe('CONTENT_COLS', () => {
  it('4개 내용 열만, 순서 고정(D1)', () => {
    expect(CONTENT_COLS).toEqual(['this_content', 'this_issue', 'next_content', 'next_issue'])
  })
})

describe('rectFromAddrs', () => {
  const rowIds = ['a', 'b', 'c']
  it('정규화(top≤bottom, left≤right) — 역방향 선택도 동일 rect', () => {
    expect(rectFromAddrs(rowIds, addr('a', 'this_content'), addr('c', 'next_content')))
      .toEqual(rect(0, 0, 2, 2))
    expect(rectFromAddrs(rowIds, addr('c', 'next_issue'), addr('a', 'this_content')))
      .toEqual(rect(0, 0, 2, 3))
  })
  it('단일 셀 → 1×1 rect', () => {
    expect(rectFromAddrs(rowIds, addr('b', 'this_issue'), addr('b', 'this_issue')))
      .toEqual(rect(1, 1, 1, 1))
  })
  it('사라진 rowId → null', () => {
    expect(rectFromAddrs(rowIds, addr('x', 'this_content'), addr('c', 'this_content'))).toBeNull()
  })
})

describe('cellsInRect', () => {
  it('행 우선 열거', () => {
    expect(cellsInRect(['a', 'b', 'c'], rect(0, 0, 1, 1))).toEqual([
      addr('a', 'this_content'), addr('a', 'this_issue'),
      addr('b', 'this_content'), addr('b', 'this_issue'),
    ])
  })
  it('범위 밖 인덱스는 클램프', () => {
    expect(cellsInRect(['a'], rect(0, 0, 5, 5))).toEqual([
      addr('a', 'this_content'), addr('a', 'this_issue'),
      addr('a', 'next_content'), addr('a', 'next_issue'),
    ])
  })
})

describe('valuesInRect', () => {
  it('CELL_FIELD로 값 격자 추출', () => {
    const rows = [
      mkRow('a', { thisContent: 'A1', thisIssue: 'A2' }),
      mkRow('b', { thisContent: 'B1', thisIssue: 'B2' }),
    ]
    expect(valuesInRect(rows, rect(0, 0, 1, 1))).toEqual([['A1', 'A2'], ['B1', 'B2']])
  })
})

describe('moveActive', () => {
  const rowIds = ['a', 'b', 'c']
  it('이동 + 경계 클램프', () => {
    expect(moveActive(rowIds, addr('b', 'this_issue'), 1, 1)).toEqual(addr('c', 'next_content'))
    expect(moveActive(rowIds, addr('b', 'this_issue'), -5, -5)).toEqual(addr('a', 'this_content'))
    expect(moveActive(rowIds, addr('b', 'this_issue'), 5, 5)).toEqual(addr('c', 'next_issue'))
  })
  it('그리드 밖 active는 그대로', () => {
    const a = addr('z', 'this_content')
    expect(moveActive(rowIds, a, 1, 0)).toBe(a)
  })
})

describe('advanceActive', () => {
  const rowIds = ['a', 'b']
  it('next: 행 끝에서 다음 행 첫 열로 래핑', () => {
    expect(advanceActive(rowIds, addr('a', 'next_issue'), 'next')).toEqual(addr('b', 'this_content'))
    expect(advanceActive(rowIds, addr('a', 'this_content'), 'next')).toEqual(addr('a', 'this_issue'))
  })
  it('prev: 행 앞에서 이전 행 끝 열로 래핑', () => {
    expect(advanceActive(rowIds, addr('b', 'this_content'), 'prev')).toEqual(addr('a', 'next_issue'))
  })
  it('문서 경계에서 정지', () => {
    expect(advanceActive(rowIds, addr('b', 'next_issue'), 'next')).toEqual(addr('b', 'next_issue'))
    expect(advanceActive(rowIds, addr('a', 'this_content'), 'prev')).toEqual(addr('a', 'this_content'))
  })
})

describe('pasteEdits', () => {
  const rowIds = ['r0', 'r1', 'r2']
  it('앵커부터 우/하 전개', () => {
    const { edits, clippedRows, clippedCols } = pasteEdits(
      rowIds, addr('r0', 'this_content'), [['a', 'b'], ['c', 'd']],
    )
    expect(edits).toEqual([
      { rowId: 'r0', cellKey: 'this_content', content: 'a' },
      { rowId: 'r0', cellKey: 'this_issue', content: 'b' },
      { rowId: 'r1', cellKey: 'this_content', content: 'c' },
      { rowId: 'r1', cellKey: 'this_issue', content: 'd' },
    ])
    expect(clippedRows).toBe(0)
    expect(clippedCols).toBe(0)
  })
  it('행 부족 시 잘라냄(D2) + clippedRows 계산', () => {
    const { edits, clippedRows } = pasteEdits(
      rowIds, addr('r1', 'this_content'), [['a'], ['b'], ['c']], // r1부터 3행 붙임 → r1,r2만 가능
    )
    expect(edits.map(e => e.rowId)).toEqual(['r1', 'r2'])
    expect(clippedRows).toBe(1)
  })
  it('4열 초과 시 잘라냄(D1) + clippedCols는 최대 폭 기준', () => {
    const { edits, clippedCols } = pasteEdits(
      rowIds, addr('r0', 'next_content'), [['x', 'y', 'z']], // next_content(2)부터 → 2칸만
    )
    expect(edits).toEqual([
      { rowId: 'r0', cellKey: 'next_content', content: 'x' },
      { rowId: 'r0', cellKey: 'next_issue', content: 'y' },
    ])
    expect(clippedCols).toBe(1)
  })
  it('앵커가 그리드 밖이면 no-op', () => {
    expect(pasteEdits(rowIds, addr('zzz', 'this_content'), [['a']]))
      .toEqual({ edits: [], clippedRows: 0, clippedCols: 0 })
  })
})

describe('fillEdits', () => {
  const rowIds = ['r0', 'r1', 'r2', 'r3', 'r4']
  const rows = rowIds.map((id, i) => mkRow(id, { thisContent: `v${i}` }))
  it('아래로 복사 채우기 — source 셀 제외', () => {
    const edits = fillEdits(rows, rowIds, rect(0, 0, 0, 0), rect(0, 0, 2, 0))
    expect(edits).toEqual([
      { rowId: 'r1', cellKey: 'this_content', content: 'v0' },
      { rowId: 'r2', cellKey: 'this_content', content: 'v0' },
    ])
  })
  it('여러 행 소스는 방향으로 반복 타일', () => {
    const edits = fillEdits(rows, rowIds, rect(0, 0, 1, 0), rect(0, 0, 4, 0))
    expect(edits.map(e => e.content)).toEqual(['v0', 'v1', 'v0']) // r2=v0, r3=v1, r4=v0
    expect(edits.map(e => e.rowId)).toEqual(['r2', 'r3', 'r4'])
  })
  it('위로 채우기도 반복(음수 오프셋 보정)', () => {
    const edits = fillEdits(rows, rowIds, rect(2, 0, 2, 0), rect(0, 0, 2, 0))
    expect(edits).toEqual([
      { rowId: 'r0', cellKey: 'this_content', content: 'v2' },
      { rowId: 'r1', cellKey: 'this_content', content: 'v2' },
    ])
  })
})

describe('clearEdits', () => {
  it('rect의 셀을 빈 문자열로, 이미 빈 셀은 스킵(AC5.4)', () => {
    const rows = [
      mkRow('a', { thisContent: 'foo', thisIssue: '' }),
      mkRow('b', { thisContent: '', thisIssue: 'bar' }),
    ]
    expect(clearEdits(rows, ['a', 'b'], rect(0, 0, 1, 1))).toEqual([
      { rowId: 'a', cellKey: 'this_content', content: '' },
      { rowId: 'b', cellKey: 'this_issue', content: '' },
    ])
  })
  it('모두 비어 있으면 no-op', () => {
    const rows = [mkRow('a'), mkRow('b')]
    expect(clearEdits(rows, ['a', 'b'], rect(0, 0, 1, 3))).toEqual([])
  })
})

describe('reconcileSelection', () => {
  const sel = (active: CellAddr, anchor: CellAddr, editing = false): SelectionState => ({ active, anchor, editing })
  it('rowIds 비면 null', () => {
    expect(reconcileSelection([], sel(addr('a', 'this_content'), addr('a', 'this_content')))).toBeNull()
  })
  it('active·anchor 모두 살아있으면 동일 참조 반환(리렌더 방지)', () => {
    const s = sel(addr('b', 'this_issue'), addr('a', 'this_content'), true)
    expect(reconcileSelection(['a', 'b', 'c'], s)).toBe(s)
  })
  it('active 소멸 → 마지막 행 클램프(열 유지) + 편집 종료', () => {
    const s = sel(addr('z', 'next_content'), addr('a', 'this_content'), true)
    expect(reconcileSelection(['a', 'b'], s)).toEqual({
      active: addr('b', 'next_content'), anchor: addr('a', 'this_content'), editing: false,
    })
  })
  it('anchor만 소멸 → active로 접어 단일 셀 선택', () => {
    const s = sel(addr('b', 'this_issue'), addr('gone', 'this_content'), true)
    expect(reconcileSelection(['a', 'b'], s)).toEqual({
      active: addr('b', 'this_issue'), anchor: addr('b', 'this_issue'), editing: true,
    })
  })
  it('active·anchor 모두 소멸 → 마지막 행 단일 셀, 편집 종료', () => {
    const s = sel(addr('x', 'next_issue'), addr('y', 'this_content'), true)
    expect(reconcileSelection(['a', 'b', 'c'], s)).toEqual({
      active: addr('c', 'next_issue'), anchor: addr('c', 'next_issue'), editing: false,
    })
  })
})

describe('적대적 경계 케이스', () => {
  it('pasteEdits: 앵커가 마지막 행&열 동시 → 단일 셀만, 나머지 clip', () => {
    const { edits, clippedRows, clippedCols } = pasteEdits(
      ['r0', 'r1', 'r2'], addr('r2', 'next_issue'), [['A', 'B'], ['C', 'D']],
    )
    expect(edits).toEqual([{ rowId: 'r2', cellKey: 'next_issue', content: 'A' }])
    expect(clippedRows).toBe(1)
    expect(clippedCols).toBe(1)
  })
  it('pasteEdits: 비정방형(jagged) values → clippedCols는 최대 폭 기준', () => {
    const { edits, clippedRows, clippedCols } = pasteEdits(
      ['r0', 'r1'], addr('r0', 'this_content'), [['a'], ['b', 'c', 'd', 'e', 'f']],
    )
    expect(edits).toEqual([
      { rowId: 'r0', cellKey: 'this_content', content: 'a' },
      { rowId: 'r1', cellKey: 'this_content', content: 'b' },
      { rowId: 'r1', cellKey: 'this_issue', content: 'c' },
      { rowId: 'r1', cellKey: 'next_content', content: 'd' },
      { rowId: 'r1', cellKey: 'next_issue', content: 'e' }, // 'f'는 4열 초과로 clip
    ])
    expect(clippedRows).toBe(0)
    expect(clippedCols).toBe(1)
  })
  it('pasteEdits: 빈 문자열 셀도 edit로 보존(공백 붙여넣기)', () => {
    const { edits } = pasteEdits(['r0'], addr('r0', 'this_content'), [['x', '', 'y']])
    expect(edits).toEqual([
      { rowId: 'r0', cellKey: 'this_content', content: 'x' },
      { rowId: 'r0', cellKey: 'this_issue', content: '' },
      { rowId: 'r0', cellKey: 'next_content', content: 'y' },
    ])
  })
  it('fillEdits: 수평(우) 채우기 — 단일 셀을 열 방향 복사', () => {
    const rows = [mkRow('r0', { thisContent: 'A' })]
    expect(fillEdits(rows, ['r0'], rect(0, 0, 0, 0), rect(0, 0, 0, 3))).toEqual([
      { rowId: 'r0', cellKey: 'this_issue', content: 'A' },
      { rowId: 'r0', cellKey: 'next_content', content: 'A' },
      { rowId: 'r0', cellKey: 'next_issue', content: 'A' },
    ])
  })
  it('fillEdits: 2D 블록(2×2)을 수평 타일로 반복', () => {
    const rows = [
      mkRow('r0', { thisContent: 'A', thisIssue: 'B' }),
      mkRow('r1', { thisContent: 'C', thisIssue: 'D' }),
    ]
    expect(fillEdits(rows, ['r0', 'r1'], rect(0, 0, 1, 1), rect(0, 0, 1, 3))).toEqual([
      { rowId: 'r0', cellKey: 'next_content', content: 'A' },
      { rowId: 'r0', cellKey: 'next_issue', content: 'B' },
      { rowId: 'r1', cellKey: 'next_content', content: 'C' },
      { rowId: 'r1', cellKey: 'next_issue', content: 'D' },
    ])
  })
})
