import { describe, it, expect } from 'vitest'
import {
  emptyUndo, pushUndo, undo, redo, UNDO_LIMIT,
  type UndoBatch, type UndoState,
} from '@/lib/domain/sheetUndo'

const batch = (n: string): UndoBatch => ({
  before: [{ rowId: 'r1', cellKey: 'this_content', content: `before${n}` }],
  after: [{ rowId: 'r1', cellKey: 'this_content', content: `after${n}` }],
})

describe('emptyUndo', () => {
  it('빈 스택', () => expect(emptyUndo).toEqual({ past: [], future: [] }))
})

describe('pushUndo', () => {
  it('past에 쌓고 future를 비운다(새 편집 → redo 무효화)', () => {
    const withFuture: UndoState = { past: [batch('1')], future: [batch('old')] }
    const next = pushUndo(withFuture, batch('2'))
    expect(next.past).toEqual([batch('1'), batch('2')])
    expect(next.future).toEqual([])
  })
  it('원본 상태를 변형하지 않는다(순수)', () => {
    const s = pushUndo(emptyUndo, batch('1'))
    expect(emptyUndo).toEqual({ past: [], future: [] })
    expect(s.past).toHaveLength(1)
  })
  it('UNDO_LIMIT 초과 시 오래된 것 폐기', () => {
    let s = emptyUndo
    for (let i = 0; i <= UNDO_LIMIT; i++) s = pushUndo(s, batch(String(i))) // LIMIT+1개 push
    expect(s.past).toHaveLength(UNDO_LIMIT)
    expect(s.past[0]).toEqual(batch('1'))                 // 0번(가장 오래된)은 폐기
    expect(s.past[UNDO_LIMIT - 1]).toEqual(batch(String(UNDO_LIMIT)))
  })
})

describe('undo', () => {
  it('빈 past → null', () => expect(undo(emptyUndo)).toBeNull())
  it('최상단을 future로 옮기고 before 값 반환', () => {
    const s: UndoState = { past: [batch('1'), batch('2')], future: [] }
    const res = undo(s)
    expect(res).not.toBeNull()
    expect(res!.apply).toEqual(batch('2').before)
    expect(res!.state.past).toEqual([batch('1')])
    expect(res!.state.future).toEqual([batch('2')])
  })
})

describe('redo', () => {
  it('빈 future → null', () => expect(redo(emptyUndo)).toBeNull())
  it('최상단을 past로 옮기고 after 값 반환', () => {
    const s: UndoState = { past: [batch('1')], future: [batch('2')] }
    const res = redo(s)
    expect(res).not.toBeNull()
    expect(res!.apply).toEqual(batch('2').after)
    expect(res!.state.past).toEqual([batch('1'), batch('2')])
    expect(res!.state.future).toEqual([])
  })
})

describe('push → undo → redo 왕복', () => {
  it('undo가 before를, redo가 after를 되돌린다', () => {
    const pushed = pushUndo(emptyUndo, batch('X'))
    const undone = undo(pushed)!
    expect(undone.apply).toEqual(batch('X').before)
    const redone = redo(undone.state)!
    expect(redone.apply).toEqual(batch('X').after)
    expect(redone.state).toEqual(pushed) // 상태 원위치
  })
  it('undo 후 새 push는 future(redo)를 폐기한다', () => {
    const pushed = pushUndo(emptyUndo, batch('1'))
    const undone = undo(pushed)!
    expect(undone.state.future).toHaveLength(1)
    const afterNew = pushUndo(undone.state, batch('2'))
    expect(afterNew.future).toEqual([])          // redo 소실
    expect(afterNew.past).toEqual([batch('2')])
  })
})
