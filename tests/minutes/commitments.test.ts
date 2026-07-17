import { describe, expect, it } from 'vitest'
import type { MinuteCommitment } from '@/lib/domain/types'
import { fnv1a64, splitMinuteBlocks, type MinuteBlock } from '@/lib/minutes/blocks'
import {
  groupMinuteCommitments,
  isCurrentMinuteCommitment,
} from '@/lib/minutes/commitments'

const BODY = 'ERP 김철수가 API 명세를 확정한다.\n\nMES는 통합 테스트를 완료한다.'
const BLOCKS = splitMinuteBlocks(BODY)
const BODY_HASH = fnv1a64(BODY)
const CONTEXT_HASH = 'context-current'

function commitment(overrides: Partial<MinuteCommitment> = {}): MinuteCommitment {
  return {
    id: 'c1',
    minuteId: 'm1',
    bodyHash: BODY_HASH,
    contextHash: CONTEXT_HASH,
    sourceRevision: 0,
    commitmentHash: 'commitment-hash',
    commitmentText: 'API 명세 확정',
    sourceQuote: 'ERP 김철수가 API 명세를 확정한다.',
    blockIndex: 0,
    blockHash: BLOCKS[0].hash,
    ownerName: '김철수',
    ownerTeam: 'ERP',
    ownerUnassigned: false,
    dueText: null,
    dueDate: null,
    dueUndecided: false,
    reviewStatus: 'pending',
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    createdAt: '2026-07-17T00:00:00Z',
    updatedAt: '2026-07-17T00:00:00Z',
    ...overrides,
  }
}

describe('isCurrentMinuteCommitment', () => {
  it('본문·컨텍스트·렌더 블록·해시·정규화 근거가 모두 맞을 때만 current다', () => {
    expect(isCurrentMinuteCommitment(
      commitment({ sourceQuote: '  ERP 김철수가\n API 명세를 확정한다.  ' }),
      BLOCKS,
      BODY_HASH,
      CONTEXT_HASH,
    )).toBe(true)
  })

  it.each([
    ['저장 body hash 불일치', commitment({ bodyHash: 'old-body' }), BLOCKS, BODY_HASH, CONTEXT_HASH],
    ['현재 body hash 없음', commitment(), BLOCKS, '', CONTEXT_HASH],
    ['저장 context hash 불일치', commitment({ contextHash: 'old-context' }), BLOCKS, BODY_HASH, CONTEXT_HASH],
    ['현재 context hash 없음', commitment(), BLOCKS, BODY_HASH, ''],
    ['범위 밖 블록', commitment({ blockIndex: 99 }), BLOCKS, BODY_HASH, CONTEXT_HASH],
    ['블록 해시 불일치', commitment({ blockHash: 'old-block' }), BLOCKS, BODY_HASH, CONTEXT_HASH],
    ['근거 인용 불일치', commitment({ sourceQuote: '원문에 없는 문장' }), BLOCKS, BODY_HASH, CONTEXT_HASH],
    ['빈 근거 인용', commitment({ sourceQuote: ' \n ' }), BLOCKS, BODY_HASH, CONTEXT_HASH],
  ] as const)('%s이면 stale이다', (_label, item, blocks, bodyHash, contextHash) => {
    expect(isCurrentMinuteCommitment(item, blocks, bodyHash, contextHash)).toBe(false)
  })

  it('비렌더 블록과 배열 위치가 자체 index와 다른 블록을 fail-closed 처리한다', () => {
    const hidden: MinuteBlock[] = [{ ...BLOCKS[0], rendered: false }]
    expect(isCurrentMinuteCommitment(commitment(), hidden, BODY_HASH, CONTEXT_HASH)).toBe(false)

    const misplaced: MinuteBlock[] = [{ ...BLOCKS[0], index: 4 }]
    expect(isCurrentMinuteCommitment(commitment(), misplaced, BODY_HASH, CONTEXT_HASH)).toBe(false)
  })

  it('정수가 아닌 블록 인덱스를 fail-closed 처리한다', () => {
    expect(isCurrentMinuteCommitment(
      commitment({ blockIndex: 0.5 }), BLOCKS, BODY_HASH, CONTEXT_HASH,
    )).toBe(false)
  })

  it('DB source revision이 바뀐 후보를 stale 처리한다', () => {
    expect(isCurrentMinuteCommitment(
      commitment({ sourceRevision: 1 }), BLOCKS, BODY_HASH, CONTEXT_HASH, 2,
    )).toBe(false)
  })
})

describe('groupMinuteCommitments', () => {
  it('상태별로 분류하고 pending을 stale → 빠른 기한 → 블록 순으로 정렬한다', () => {
    const list = [
      commitment({ id: 'current-no-due', blockIndex: 0, dueDate: null }),
      commitment({
        id: 'current-later', blockIndex: 1, blockHash: BLOCKS[1].hash,
        sourceQuote: BLOCKS[1].text, dueDate: '2026-07-25',
      }),
      commitment({ id: 'stale-later-block', blockIndex: 1, dueDate: '2026-08-01', blockHash: 'stale' }),
      commitment({ id: 'current-earlier-block-1', blockIndex: 1, blockHash: BLOCKS[1].hash,
        sourceQuote: BLOCKS[1].text, dueDate: '2026-07-20' }),
      commitment({ id: 'current-earlier-block-0', blockIndex: 0, dueDate: '2026-07-20' }),
      commitment({ id: 'stale-early-date', dueDate: '2026-01-01', contextHash: 'old' }),
      commitment({ id: 'confirmed', reviewStatus: 'confirmed' }),
      commitment({ id: 'rejected', reviewStatus: 'rejected' }),
    ]

    const groups = groupMinuteCommitments(list, BLOCKS, BODY_HASH, CONTEXT_HASH)

    expect(groups.pending.map(item => item.id)).toEqual([
      'stale-early-date',
      'stale-later-block',
      'current-earlier-block-0',
      'current-earlier-block-1',
      'current-later',
      'current-no-due',
    ])
    expect(groups.confirmed.map(item => item.id)).toEqual(['confirmed'])
    expect(groups.rejected.map(item => item.id)).toEqual(['rejected'])
  })

  it('입력 배열과 확정·반려의 원래 순서를 변경하지 않는다', () => {
    const list = [
      commitment({ id: 'confirmed-2', reviewStatus: 'confirmed' }),
      commitment({ id: 'pending-late', dueDate: '2026-08-01' }),
      commitment({ id: 'rejected-2', reviewStatus: 'rejected' }),
      commitment({ id: 'confirmed-1', reviewStatus: 'confirmed' }),
      commitment({ id: 'pending-early', dueDate: '2026-07-18' }),
      commitment({ id: 'rejected-1', reviewStatus: 'rejected' }),
    ]
    const originalIds = list.map(item => item.id)

    const groups = groupMinuteCommitments(list, BLOCKS, BODY_HASH, CONTEXT_HASH)

    expect(list.map(item => item.id)).toEqual(originalIds)
    expect(groups.confirmed.map(item => item.id)).toEqual(['confirmed-2', 'confirmed-1'])
    expect(groups.rejected.map(item => item.id)).toEqual(['rejected-2', 'rejected-1'])
    expect(groups.pending.map(item => item.id)).toEqual(['pending-early', 'pending-late'])
  })

  it('잘못된 dueDate는 미지정 기한처럼 마지막에 두고 잘못된 runtime 상태는 분류하지 않는다', () => {
    const invalidStatus = commitment({ id: 'unknown' })
    ;(invalidStatus as { reviewStatus: string }).reviewStatus = 'unknown'
    const groups = groupMinuteCommitments([
      commitment({ id: 'bad-date', dueDate: 'not-a-date' }),
      commitment({ id: 'real-date', dueDate: '2026-07-19' }),
      invalidStatus,
    ], BLOCKS, BODY_HASH, CONTEXT_HASH)

    expect(groups.pending.map(item => item.id)).toEqual(['real-date', 'bad-date'])
    expect(groups.confirmed).toEqual([])
    expect(groups.rejected).toEqual([])
  })
})
