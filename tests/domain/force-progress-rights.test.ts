// 사이드바 강제 진행 버튼 노출(스펙 §3.2) — 후행의 서브트리 관리자면 보인다. F15: 후행 담당자는 stub 하위의 관리자가 아니다.
import { describe, expect, it } from 'vitest'
import { subtreeManagedIds } from '@/lib/domain/forceProgressRights'
import type { ComputedItem } from '@/lib/domain/types'

const n = (id: string, over: Partial<ComputedItem> = {}): ComputedItem => ({
  id, parentId: null, code: id, sortOrder: 1, name: id, biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false, children: [], subTasks: [], depth: 0,
  plannedPct: 0, rolledActualPct: 0, achievement: 0, status: 'not_started', ...over,
} as ComputedItem)

const sub = n('sub', { parentId: 'succ', assigneeMemberId: 'dev', stubFor: 'm/P', depends: ['m/P', 'm/S'] })
const succ = n('succ', { parentId: 'wp', assigneeMemberId: 'dev', depends: ['m/P'], subTasks: [sub] })
const other = n('other', { parentId: 'wp' })
const wp = n('wp', { assigneeMemberId: 'lead', children: [succ, other] })

describe('subtreeManagedIds', () => {
  it('조상 담당자는 선행이 있는 리프와 그 stub 하위를 관리한다', () => {
    expect(subtreeManagedIds([wp], ['lead'])).toEqual(['succ', 'sub'])
  })
  it('후행 담당자는 후행도(자기 자신), stub 하위도(F15) 관리하지 않는다', () => {
    expect(subtreeManagedIds([wp], ['dev'])).toEqual([])
  })
  it('로스터 행이 없으면 빈 목록', () => {
    expect(subtreeManagedIds([wp], [])).toEqual([])
  })
})
