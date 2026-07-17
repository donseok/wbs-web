import type { MinuteCommitment } from '@/lib/domain/types'
import type { MinuteBlock } from './blocks'

export interface GroupedMinuteCommitments {
  pending: MinuteCommitment[]
  confirmed: MinuteCommitment[]
  rejected: MinuteCommitment[]
}

function normalizeQuote(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * 저장된 약속의 추출 컨텍스트와 원문 근거가 현재 회의록에도 그대로 존재하는지 판정한다.
 * 어느 한 값이라도 비었거나 어긋나면 유사 문장을 추측해 연결하지 않고 stale 로 처리한다.
 */
export function isCurrentMinuteCommitment(
  commitment: MinuteCommitment,
  blocks: MinuteBlock[],
  bodyHash: string,
  contextHash: string,
  sourceRevision?: number,
): boolean {
  if (!bodyHash || !contextHash) return false
  if (commitment.bodyHash !== bodyHash || commitment.contextHash !== contextHash) return false
  if (sourceRevision !== undefined && commitment.sourceRevision !== sourceRevision) return false
  if (!Number.isSafeInteger(commitment.blockIndex) || commitment.blockIndex < 0) return false

  const block = blocks[commitment.blockIndex]
  if (!block || block.index !== commitment.blockIndex || block.rendered !== true) return false
  if (!commitment.blockHash || block.hash !== commitment.blockHash) return false

  const sourceQuote = normalizeQuote(commitment.sourceQuote)
  if (!sourceQuote) return false
  return normalizeQuote(block.text).includes(sourceQuote)
}

function dueDateSortKey(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function blockIndexSortKey(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER
}

/**
 * 검토 상태별로 분류한다. 검토 대기는 사용자가 먼저 복구할 수 있도록 stale 항목을 앞에 두고,
 * 같은 신선도 안에서는 빠른 기한(null/잘못된 값은 마지막), 원문 블록 순으로 정렬한다.
 * 입력 배열과 확정/반려 순서는 변경하지 않는다.
 */
export function groupMinuteCommitments(
  commitments: MinuteCommitment[],
  blocks: MinuteBlock[],
  bodyHash: string,
  contextHash: string,
  sourceRevision?: number,
): GroupedMinuteCommitments {
  const groups: GroupedMinuteCommitments = { pending: [], confirmed: [], rejected: [] }

  for (const commitment of commitments) {
    if (commitment.reviewStatus === 'pending') groups.pending.push(commitment)
    else if (commitment.reviewStatus === 'confirmed') groups.confirmed.push(commitment)
    else if (commitment.reviewStatus === 'rejected') groups.rejected.push(commitment)
  }

  groups.pending.sort((a, b) => {
    const aCurrent = isCurrentMinuteCommitment(a, blocks, bodyHash, contextHash, sourceRevision)
    const bCurrent = isCurrentMinuteCommitment(b, blocks, bodyHash, contextHash, sourceRevision)
    if (aCurrent !== bCurrent) return aCurrent ? 1 : -1

    const aDue = dueDateSortKey(a.dueDate)
    const bDue = dueDateSortKey(b.dueDate)
    if (aDue !== bDue) {
      if (aDue === null) return 1
      if (bDue === null) return -1
      return aDue < bDue ? -1 : 1
    }
    return blockIndexSortKey(a.blockIndex) - blockIndexSortKey(b.blockIndex)
  })

  return groups
}
