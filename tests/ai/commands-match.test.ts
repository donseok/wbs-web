// tests/ai/commands-match.test.ts
import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import { collectCandidates, matchCandidates } from '@/lib/ai/commands/match'
import { buildProposal } from '@/lib/ai/commands/propose'

const leaf = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'x', parentId: null, level: 'activity', code: '', sortOrder: 0,
    name: '', biz: null, deliverable: null, plannedStart: '2026-07-01',
    plannedEnd: '2026-07-31', weight: null, actualPct: 40, owners: [],
    plannedPct: 50, rolledActualPct: 40, achievement: null,
    status: 'in_progress', children: [], ...over,
  }) as ComputedItem

const tree: ComputedItem[] = [
  leaf({
    id: 'ph1', name: '2. As-Is 분석', level: 'phase',
    children: [
      leaf({ id: 'a', name: 'ERP 인터페이스 설계', owners: [{ team: 'ERP', kind: 'primary' }] }),
      leaf({ id: 'b', name: 'ERP 인터페이스 설계 검토' }),
      leaf({ id: 'c', name: '기준정보 정제', actualPct: null, rolledActualPct: 0 }),
    ],
  }),
]

describe('collectCandidates — 리프 평탄화 + phaseName', () => {
  it('리프만 뽑고 루트 phase 이름을 단다', () => {
    const cands = collectCandidates(tree)
    expect(cands.map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(cands[0].phaseName).toBe('2. As-Is 분석')
    expect(cands[0].currentActual).toBe(40)
    expect(cands[2].currentActual).toBeNull()
  })
})

describe('matchCandidates — 정규화 부분일치', () => {
  const all = collectCandidates(tree)
  it('공백·대소문자 무시 부분일치', () => {
    expect(matchCandidates('erp인터페이스설계', all).map(c => c.id)).toEqual(['a', 'b'])
  })
  it('정확 일치가 있으면 그것만', () => {
    expect(matchCandidates('ERP 인터페이스 설계', all).map(c => c.id)).toEqual(['a'])
  })
  it('0건', () => {
    expect(matchCandidates('없는 작업', all)).toEqual([])
  })
})

describe('buildProposal — 제안/되묻기/못찾음', () => {
  const all = collectCandidates(tree)
  it('1건 매칭 → proposal + before/after 변경 요약', () => {
    const p = buildProposal(
      { action: 'set_actual', targetQuery: 'ERP 인터페이스 설계', actualPct: 80 },
      matchCandidates('ERP 인터페이스 설계', all),
    )
    expect(p.kind).toBe('proposal')
    if (p.kind === 'proposal') {
      expect(p.target.id).toBe('a')
      expect(p.params).toEqual({ actualPct: 80 })
      expect(p.changes).toEqual([
        { field: 'actual_pct', label: '실적', before: '40%', after: '80%' },
      ])
    }
  })
  it('complete는 실적 100 변경으로 표현', () => {
    const p = buildProposal(
      { action: 'complete', targetQuery: '기준정보 정제' },
      matchCandidates('기준정보 정제', all),
    )
    if (p.kind === 'proposal') {
      expect(p.params).toEqual({ actualPct: 100 }) // complete = 실적 100 (전용 액션 없음)
      expect(p.changes[0]).toEqual({ field: 'actual_pct', label: '실적', before: '0%', after: '100%' })
    } else {
      throw new Error('proposal이어야 함')
    }
  })
  it('다건 → disambiguate', () => {
    const p = buildProposal(
      { action: 'set_actual', targetQuery: 'erp인터페이스설계', actualPct: 80 },
      matchCandidates('erp인터페이스설계', all),
    )
    expect(p.kind).toBe('disambiguate')
  })
  it('0건 → not_found', () => {
    expect(buildProposal({ action: 'complete', targetQuery: '없음' }, []).kind).toBe('not_found')
  })
})
