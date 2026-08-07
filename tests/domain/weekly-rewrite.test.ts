import { describe, expect, it } from 'vitest'
import {
  buildWeeklyRewriteSelection, prepareApplicableWeeklyRewriteEdits,
  type WeeklyRewriteCandidate,
} from '@/lib/domain/weeklyRewrite'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

const row = (id: string, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow => ({
  id,
  reportId: 'report-1',
  section: id === 'r1' ? '영업' : '품질',
  module: '',
  sortOrder: id === 'r1' ? 1 : 2,
  thisContent: '',
  thisIssue: '',
  nextContent: '',
  nextIssue: '',
  ...over,
})

describe('buildWeeklyRewriteSelection', () => {
  it('선택 범위에서 빈 셀을 제외하고 행 우선 순서와 표시 문구를 보존한다', () => {
    const rows = [
      row('r1', { thisContent: '금주 영업', nextContent: '차주 영업' }),
      row('r2', { thisIssue: '품질 이슈', nextContent: '   ' }),
    ]
    expect(buildWeeklyRewriteSelection(rows, { top: 0, left: 0, bottom: 1, right: 2 })).toEqual([
      { rowId: 'r1', cellKey: 'this_content', section: '영업', label: '금주실적 내용', original: '금주 영업' },
      { rowId: 'r1', cellKey: 'next_content', section: '영업', label: '차주계획 내용', original: '차주 영업' },
      { rowId: 'r2', cellKey: 'this_issue', section: '품질', label: '금주 이슈·이벤트', original: '품질 이슈' },
    ])
  })
})

describe('prepareApplicableWeeklyRewriteEdits', () => {
  const rows = [row('r1', { thisContent: '원문 A', thisIssue: '원문 B' })]
  const candidates: WeeklyRewriteCandidate[] = [
    { rowId: 'r1', cellKey: 'this_content', original: '원문 A', content: '정리한 A' },
    { rowId: 'r1', cellKey: 'this_issue', original: '원문 B', content: '정리한 B' },
  ]

  it('원문이 그대로인 변경만 저장 edit으로 만든다', () => {
    expect(prepareApplicableWeeklyRewriteEdits(rows, candidates)).toEqual({
      ok: true,
      edits: [
        { rowId: 'r1', cellKey: 'this_content', content: '정리한 A' },
        { rowId: 'r1', cellKey: 'this_issue', content: '정리한 B' },
      ],
    })
  })

  it('행 삭제나 동시 수정이 하나라도 있으면 전체 적용을 막는다', () => {
    expect(prepareApplicableWeeklyRewriteEdits([], candidates)).toEqual({ ok: false })
    expect(prepareApplicableWeeklyRewriteEdits(
      [row('r1', { thisContent: '다른 사용자가 수정', thisIssue: '원문 B' })],
      candidates,
    )).toEqual({ ok: false })
  })

  it('중복 주소는 거부하고 동일·빈 제안은 저장에서 제외한다', () => {
    expect(prepareApplicableWeeklyRewriteEdits(rows, [candidates[0], candidates[0]])).toEqual({ ok: false })
    expect(prepareApplicableWeeklyRewriteEdits(rows, [
      { ...candidates[0], content: '원문 A' },
      { ...candidates[1], content: '   ' },
    ])).toEqual({ ok: true, edits: [] })
  })
})
