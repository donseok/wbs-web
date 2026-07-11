import { describe, it, expect } from 'vitest'
import {
  projectLifecycleStatus,
  computeCompletionMap,
  type ProjectCompletion,
} from '@/lib/domain/project-status'

const done: ProjectCompletion = { hasWbs: true, allDone: true }
const notDone: ProjectCompletion = { hasWbs: true, allDone: false }
const noWbs: ProjectCompletion = { hasWbs: false, allDone: false }

describe('projectLifecycleStatus — 날짜+실제 완료율 결합 판정', () => {
  it('시작 전이면 ready', () => {
    expect(projectLifecycleStatus('2026-08-01', '2026-12-31', '2026-07-14', notDone)).toBe('ready')
  })
  it('기간 내면 active (완료율 무관)', () => {
    expect(projectLifecycleStatus('2026-07-01', '2026-12-31', '2026-07-14', notDone)).toBe('active')
  })
  it('종료일 경과 + 전 리프 완료면 done', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', done)).toBe('done')
  })
  it('종료일 경과 + 미완 리프 존재면 overdue (기존 결함의 수정 지점)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', notDone)).toBe('overdue')
  })
  it('종료일 경과 + WBS 없음이면 done (판단 근거 없음 — 날짜 기준 유지)', () => {
    expect(projectLifecycleStatus('2026-01-01', '2026-07-01', '2026-07-14', noWbs)).toBe('done')
  })
  it('날짜 미설정이면 ready', () => {
    expect(projectLifecycleStatus(null, null, '2026-07-14', done)).toBe('ready')
  })
})

describe('computeCompletionMap — 리프 판정(자식 유무) + 전량 완료', () => {
  it('자식 없는 행만 리프로 집계하고 프로젝트별로 묶는다', () => {
    const map = computeCompletionMap([
      { id: 'a', parentId: null, projectId: 'p1', actualPct: null }, // 부모
      { id: 'b', parentId: 'a', projectId: 'p1', actualPct: 100 },
      { id: 'c', parentId: 'a', projectId: 'p1', actualPct: 100 },
      { id: 'd', parentId: null, projectId: 'p2', actualPct: 50 }, // 단독 리프
    ])
    expect(map['p1']).toEqual({ hasWbs: true, allDone: true })
    expect(map['p2']).toEqual({ hasWbs: true, allDone: false })
  })
  it('done 판정은 원시값 >= 100 (99.5는 미완 — statusOf 규약과 동일)', () => {
    const map = computeCompletionMap([
      { id: 'x', parentId: null, projectId: 'p', actualPct: 99.5 },
    ])
    expect(map['p'].allDone).toBe(false)
  })
  it('빈 입력이면 빈 맵', () => {
    expect(computeCompletionMap([])).toEqual({})
  })
})
