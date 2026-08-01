export const ISSUE_MINUTE_SOURCE_KINDS = ['manual', 'action', 'risk'] as const
export type IssueMinuteSourceKind = (typeof ISSUE_MINUTE_SOURCE_KINDS)[number]

export interface MinuteIssueSourceKeyInput {
  minuteVersionId: string
  blockIndex: number
  blockHash: string
  kind: IssueMinuteSourceKind
  /** 드래그 선택 발췌의 공백 제거 fnv1a64 — 선택 등록만 채운다(블록 전체 등록과 조회 키 구분). */
  selectionHash?: string | null
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
  piIssueCode: string | null
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
  const parts = [
    'minute',
    encodeURIComponent(input.minuteVersionId),
    String(input.blockIndex),
    input.blockHash.toLowerCase(),
    input.kind,
  ]
  if (input.selectionHash) parts.push('sel', input.selectionHash.toLowerCase())
  return parts.join(':')
}

function compactTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 200) return normalized
  // 제목 중간을 잘라 생략 표시를 붙이지 않는다. 200자 안에서 끝나는 첫 문장이
  // 없으면 정확하지 않은 절반 문장보다 사용자가 원문을 확인하게 하는 완결 문구를 쓴다.
  const complete = normalized.match(/^.{1,199}?[.!?。](?=\s|$)/)?.[0]?.trim()
  return complete || '회의록 이슈 내용 확인 필요'
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
