import { describe, it, expect } from 'vitest'
import { validateLevelSettings, treeMaxDepth, LEVEL_LABELS_MAX } from '@/lib/domain/levelSettings'

describe('treeMaxDepth — parent_id 체인에서 최대 깊이(0-base)', () => {
  it('빈 트리는 null', () => {
    expect(treeMaxDepth([])).toBeNull()
  })

  it('루트만 있으면 0', () => {
    expect(treeMaxDepth([{ id: 'a', parent_id: null }])).toBe(0)
  })

  it('체인 깊이를 계산한다 — 루트→자식→손자 = 2', () => {
    expect(treeMaxDepth([
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
      { id: 'd', parent_id: 'a' },
    ])).toBe(2)
  })

  it('부모가 조회 집합에 없는 고아는 루트로 취급한다 — 깊이를 과대평가하지 않는다', () => {
    expect(treeMaxDepth([{ id: 'x', parent_id: 'ghost' }])).toBe(0)
  })

  it('순환 참조가 있어도 무한 루프 없이 끝난다', () => {
    const r = treeMaxDepth([
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ])
    expect(typeof r).toBe('number')
  })
})

describe('validateLevelSettings — 라벨 배열이 곧 깊이(labels.length = maxDepth)', () => {
  it('정상 입력이면 trim 된 라벨과 maxDepth(=길이)를 돌려준다', () => {
    const r = validateLevelSettings({
      labels: [' Phase ', 'System', 'Subsystem', 'WP', 'Activity', 'Task'],
      currentTreeMaxDepth: 2,
    })
    expect(r).toEqual({
      ok: true,
      labels: ['Phase', 'System', 'Subsystem', 'WP', 'Activity', 'Task'],
      maxDepth: 6,
    })
  })

  it('빈 배열은 거부한다', () => {
    const r = validateLevelSettings({ labels: [], currentTreeMaxDepth: null })
    expect(r.ok).toBe(false)
  })

  it('trim 후 빈 라벨이 하나라도 있으면 거부한다', () => {
    const r = validateLevelSettings({ labels: ['Phase', '  ', 'Task'], currentTreeMaxDepth: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('2')  // 몇 번째가 비었는지 알려준다
  })

  it('중복 라벨은 거부한다 — 엑셀 헤더·화면 열 이름이 모호해진다', () => {
    const r = validateLevelSettings({ labels: ['Phase', 'Task', 'Phase'], currentTreeMaxDepth: null })
    expect(r.ok).toBe(false)
  })

  it('상한을 넘는 단수는 거부한다', () => {
    const labels = Array.from({ length: LEVEL_LABELS_MAX + 1 }, (_, i) => `L${i}`)
    const r = validateLevelSettings({ labels, currentTreeMaxDepth: null })
    expect(r.ok).toBe(false)
  })

  it('기존 트리보다 얕게 줄이면 거부한다 (fail-closed) — depth 5 노드가 있는데 3단으로', () => {
    const r = validateLevelSettings({ labels: ['Phase', 'Task', 'Activity'], currentTreeMaxDepth: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/6단|깊이/)
  })

  it('기존 트리 최대 깊이와 정확히 같은 단수는 허용한다 — depth 5 = 6단 필요, 6개 제공', () => {
    const r = validateLevelSettings({
      labels: ['P', 'S', 'B', 'W', 'A', 'T'],
      currentTreeMaxDepth: 5,
    })
    expect(r.ok).toBe(true)
  })

  it('트리가 비어 있으면(currentTreeMaxDepth null) 축소 검증을 건너뛴다', () => {
    const r = validateLevelSettings({ labels: ['한 단'], currentTreeMaxDepth: null })
    expect(r).toEqual({ ok: true, labels: ['한 단'], maxDepth: 1 })
  })
})
