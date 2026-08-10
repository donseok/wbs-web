import { describe, it, expect } from 'vitest'
import { dropHidden } from '@/lib/data/minutes'

// 비공개 프로젝트(0070) — 회의록 목록 표면(달력·검색·탐색기)의 항목 필터.
// IO 는 각 조회 함수가 붙이고, 제외 규칙 자체는 이 순수 함수 하나다.
describe('dropHidden — 비공개 프로젝트 회의록 제외', () => {
  const rows = [
    { id: 'm1', projectId: 'p-pub' },
    { id: 'm2', projectId: 'p-priv' },
    { id: 'm3', projectId: null },
  ]
  it('숨김 프로젝트의 회의록만 빠진다', () => {
    expect(dropHidden(rows, new Set(['p-priv'])).map(r => r.id)).toEqual(['m1', 'm3'])
  })
  it('미지정(projectId null) 회의록은 유지된다', () => {
    expect(dropHidden(rows, new Set(['p-priv', 'p-pub'])).map(r => r.id)).toEqual(['m3'])
  })
  it('숨김 집합이 비면 원본 그대로 — 공개 프로젝트만 있는 기존 동작 무변경', () => {
    expect(dropHidden(rows, new Set())).toBe(rows)
  })
})
