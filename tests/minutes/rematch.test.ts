import { describe, it, expect } from 'vitest'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'

const row = (over: Partial<HighlightRow>): HighlightRow => ({
  id: 'r1', created_by: 'u1', created_by_name: '김철수',
  block_index: 0, block_hash: '', created_at: '2026-07-12T00:00:00Z', ...over,
})
// 특정 본문의 블록 해시를 얻는 헬퍼
const hashesOf = (md: string) => splitMinuteBlocks(md).map(b => b.hash)

describe('rematchHighlights', () => {
  it('전체 +1 시프트(상단 문단 삽입) — 인접 하이라이트 2개가 모두 보존', () => {
    const oldMd = 'A문단\n\nB문단\n\nC문단'
    const newMd = '새 문단\n\nA문단\n\nB문단\n\nC문단'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'a', block_index: 0, block_hash: oh[0] }),
      row({ id: 'b', block_index: 1, block_hash: oh[1] }),
    ]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks(newMd))
    expect(reinserts.map(r => [r.id, r.block_index])).toEqual([['a', 1], ['b', 2]])
    expect(deleteIds.sort()).toEqual(['a', 'b'])  // 이동 대상의 원 행도 삭제 목록에 포함
  })

  it('두 블록 스왑 — delete→reinsert 방식이라 충돌 없이 교차 배정', () => {
    const oldMd = 'X내용\n\nY내용'
    const newMd = 'Y내용\n\nX내용'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'x', block_index: 0, block_hash: oh[0] }),
      row({ id: 'y', block_index: 1, block_hash: oh[1] }),
    ]
    const { reinserts } = rematchHighlights(old, splitMinuteBlocks(newMd))
    expect(reinserts.find(r => r.id === 'x')!.block_index).toBe(1)
    expect(reinserts.find(r => r.id === 'y')!.block_index).toBe(0)
  })

  it('중복 해시 — 같은 사용자·같은 해시 여러 행은 문서 순 1:1, 남으면 삭제', () => {
    const oldMd = '중복\n\n중복\n\n중복'
    const newMd = '중복\n\n다른 내용'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'a', block_index: 0, block_hash: oh[0] }),
      row({ id: 'b', block_index: 1, block_hash: oh[1] }),
      row({ id: 'c', block_index: 2, block_hash: oh[2] }),
    ]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks(newMd))
    // 새 본문에 '중복' 블록 1개 → a만 index 0 유지(무변경 — reinsert 불필요), b·c 삭제
    expect(reinserts).toEqual([])
    expect(deleteIds.sort()).toEqual(['b', 'c'])
  })

  it('다른 사용자는 같은 새 인덱스를 공유', () => {
    const oldMd = '공통 문단'
    const newMd = '앞 문단\n\n공통 문단'
    const oh = hashesOf(oldMd)
    const old = [
      row({ id: 'a', created_by: 'u1', block_index: 0, block_hash: oh[0] }),
      row({ id: 'b', created_by: 'u2', block_index: 0, block_hash: oh[0] }),
    ]
    const { reinserts } = rematchHighlights(old, splitMinuteBlocks(newMd))
    expect(reinserts.map(r => r.block_index)).toEqual([1, 1])
  })

  it('소실 블록의 하이라이트는 삭제(orphan 미보존)', () => {
    const old = [row({ id: 'gone', block_index: 0, block_hash: hashesOf('사라질 문단')[0] })]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks('완전히 다른 본문'))
    expect(reinserts).toEqual([])
    expect(deleteIds).toEqual(['gone'])
  })

  it('인덱스 무변경 행은 reinserts/deleteIds 어디에도 없음', () => {
    const md = '그대로'
    const old = [row({ id: 'same', block_index: 0, block_hash: hashesOf(md)[0] })]
    const { reinserts, deleteIds } = rematchHighlights(old, splitMinuteBlocks(md))
    expect(reinserts).toEqual([])
    expect(deleteIds).toEqual([])
  })
})
