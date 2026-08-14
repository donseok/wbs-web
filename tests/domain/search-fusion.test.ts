import { describe, expect, it } from 'vitest'
import { fuseSearchResults, RRF_K, type FusionCandidate } from '@/lib/domain/searchFusion'

function chunk(entityId: string, chunkNo: number, extra: Partial<FusionCandidate> = {}): FusionCandidate {
  return {
    domain: 'minutes', entityType: 'minute', entityId, projectId: 'p1', chunkNo,
    title: `회의록 ${entityId}`, content: `본문 ${chunkNo}`, href: `/m/${entityId}`,
    occurredOn: '2026-07-01', ...extra,
  }
}

describe('fuseSearchResults', () => {
  it('같은 문서의 청크 여러 개를 한 행으로 접는다', () => {
    const out = fuseSearchResults([chunk('A', 0), chunk('A', 1), chunk('A', 2)], [])
    expect(out).toHaveLength(1)
    expect(out[0].entityId).toBe('A')
  })

  it('문서 점수는 최고 청크 점수다 — 합산하면 긴 문서가 유리해진다', () => {
    // A 는 1·2·3위를 독식, B 는 4위 하나. 합산이면 A 가 압도하지만
    // 최고점 기준이면 A(1위) > B(4위) 로 격차가 청크 수에 안 휘둘린다.
    const out = fuseSearchResults([chunk('A', 0), chunk('A', 1), chunk('A', 2), chunk('B', 0)], [])
    expect(out.map(d => d.entityId)).toEqual(['A', 'B'])
    expect(out[0].score).toBeCloseTo(1 / (RRF_K + 1), 10)
    expect(out[1].score).toBeCloseTo(1 / (RRF_K + 4), 10)
  })

  it('두 다리에 모두 걸리면 점수가 합쳐진다', () => {
    const out = fuseSearchResults([chunk('A', 0)], [chunk('A', 0)])
    expect(out[0].score).toBeCloseTo(2 / (RRF_K + 1), 10)
    expect(out[0].matchedBy).toEqual(['lexical', 'vector'])
  })

  it('한쪽이 비어도 동작한다', () => {
    expect(fuseSearchResults([], [chunk('A', 0)])).toHaveLength(1)
    expect(fuseSearchResults([], [])).toEqual([])
  })

  it('동점은 occurred_on 최신 → entityId 사전순으로 깬다(결정성)', () => {
    const older = chunk('Z', 0, { occurredOn: '2026-01-01' })
    const newer = chunk('A', 0, { occurredOn: '2026-08-01' })
    // 양쪽 다 어휘 1위 하나씩이 되도록 서로 다른 배열의 같은 순위에 놓는다
    const out = fuseSearchResults([newer], [older])
    expect(out.map(d => d.entityId)).toEqual(['A', 'Z'])
  })

  it('서로 다른 도메인의 같은 entityId 는 다른 문서다', () => {
    const a = chunk('X', 0)
    const b = chunk('X', 0, { domain: 'issues', entityType: 'issue' })
    expect(fuseSearchResults([a, b], [])).toHaveLength(2)
  })

  it('limit 을 넘기면 잘린다', () => {
    const many = Array.from({ length: 30 }, (_, i) => chunk(`E${i}`, 0))
    expect(fuseSearchResults(many, [], 10)).toHaveLength(10)
  })
})
