export const ISSUE_MINUTE_SOURCE_KINDS = ['manual', 'action', 'risk'] as const
export type IssueMinuteSourceKind = (typeof ISSUE_MINUTE_SOURCE_KINDS)[number]

export interface MinuteIssueSourceKeyInput {
  minuteVersionId: string
  blockIndex: number
  blockHash: string
  kind: IssueMinuteSourceKind
}

export interface IssueMinuteSource {
  id: string
  issueId: string
  projectId: string
  minuteId: string
  minuteVersionId: string
  minuteVersionNo: number
  minuteTitle: string
  minuteDate: string
  bodyHash: string
  blockIndex: number
  blockHash: string
  excerpt: string
  kind: IssueMinuteSourceKind
  sourceKey: string | null
  createdAt: string
}

/** 회의록 화면에서 현재 블록에 연결된 이슈를 표시하기 위한 경량 읽기 모델. */
export interface MinuteLinkedIssue {
  linkId: string
  issueId: string
  issueNo: number
  projectId: string
  title: string
  status: 'open' | 'in_progress' | 'resolved' | 'on_hold'
  minuteVersionId: string
  bodyHash: string
  blockIndex: number
  blockHash: string
}

/**
 * 회의록 버전의 한 블록에서 파생된 이슈 후보를 식별하는 안정 키.
 * manual 은 같은 블록에서 별도 이슈를 만들 수 있어 DB에서 unique로 강제하지 않고,
 * 기존 연결을 사용자에게 안내하는 조회 키로 사용한다.
 */
export function makeMinuteIssueSourceKey(input: MinuteIssueSourceKeyInput): string {
  return [
    'minute',
    encodeURIComponent(input.minuteVersionId),
    String(input.blockIndex),
    input.blockHash.toLowerCase(),
    input.kind,
  ].join(':')
}

function compactTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 200) return normalized
  return normalized.slice(0, 197).trimEnd() + '…'
}

/** 선택 블록을 이슈 초안으로 바꾸되 원문 본문은 손실 없이 보존한다. */
export function issueDraftFromBlock(text: string, insightLabel?: string | null): {
  title: string
  body: string
} {
  const preferred = insightLabel?.trim() || text.split(/\r?\n/, 1)[0] || text
  return {
    title: compactTitle(preferred) || '회의록 확인 필요',
    body: text,
  }
}

/** 둘 중 하나가 비어 있으면 허용하고, 범위가 완성됐을 때만 순서를 검증한다. */
export function validateIssueDateRange(
  startDate: string | null,
  dueDate: string | null,
): boolean {
  return startDate === null || dueDate === null || startDate <= dueDate
}
