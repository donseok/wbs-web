import { describe, expect, it } from 'vitest'
import { buildMinuteTocEntries } from '@/components/minutes/MinuteToc'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import type { MinuteLinkedIssue } from '@/lib/domain/issueMinuteSource'

const bodyMd = '# 첫 번째\n\n이슈 원문 A\n\n## 두 번째\n\n이슈 원문 B'
const blocks = splitMinuteBlocks(bodyMd)

function linkedIssue(linkId: string, blockIndex: number): MinuteLinkedIssue {
  return {
    linkId,
    issueId: `issue-${linkId}`,
    issueNo: Number(linkId),
    piIssueCode: null,
    projectId: 'project-1',
    title: `이슈 ${linkId}`,
    status: 'open',
    minuteVersionId: 'version-1',
    bodyHash: 'aaaaaaaaaaaaaaaa',
    blockIndex,
    blockHash: blocks[blockIndex].hash,
  }
}

describe('회의록 목차 연결 이슈 집계', () => {
  it('헤딩 구간별 이슈 건수와 첫 원문 블록을 유지한다', () => {
    const entries = buildMinuteTocEntries(
      blocks,
      [],
      [],
      [linkedIssue('1', 1), linkedIssue('2', 1), linkedIssue('3', 3)],
    )

    expect(entries.map(entry => ({
      heading: entry.blockIndex,
      issueCount: entry.issueCount,
      firstIssueBlock: entry.firstIssueBlock,
    }))).toEqual([
      { heading: 0, issueCount: 2, firstIssueBlock: 1 },
      { heading: 2, issueCount: 1, firstIssueBlock: 3 },
    ])
  })
})
