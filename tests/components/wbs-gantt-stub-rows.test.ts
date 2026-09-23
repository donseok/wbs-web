import { describe, expect, it } from 'vitest'
import { findAncestorPath, flattenForSheet } from '@/components/wbs/sheetTree'
import type { ComputedItem } from '@/lib/domain/types'

const n = (id: string, over: Partial<ComputedItem> = {}): ComputedItem => ({
  id, parentId: null, code: id, sortOrder: 1, name: id, biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false, children: [], subTasks: [], depth: 0,
  plannedPct: 0, rolledActualPct: 0, achievement: 0, status: 'not_started', ...over,
} as ComputedItem)

const sub = n('sub', { parentId: 'succ', depth: 2, stubFor: 'm/TSK-01' })
const succ = n('succ', { parentId: 'wp', depth: 1, subTasks: [sub] })
const wp = n('wp', { children: [succ] })

describe('WBS 표 — stub 하위 행', () => {
  it('하위는 후행 바로 뒤에 온다', () => {
    expect(flattenForSheet([wp], new Set()).map(x => x.id)).toEqual(['wp', 'succ', 'sub'])
  })
  it('부모를 접으면 하위도 숨는다', () => {
    expect(flattenForSheet([wp], new Set(['wp'])).map(x => x.id)).toEqual(['wp'])
  })
  it('?focus= 조상 경로가 subTasks 를 탄다', () => {
    expect(findAncestorPath([wp], 'sub')).toEqual(['wp', 'succ'])
  })
})
