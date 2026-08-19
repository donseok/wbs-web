// 이슈 조치/해결 경과 이력 도메인 — 순수 함수만(I/O 없음).
// 스펙: docs/superpowers/specs/2026-08-19-issue-updates-design.md
//
// 이 파일이 @/lib/domain 아래 있는 이유: 서버 액션 테스트가 @/lib/authz 와
// @/lib/supabase/* 를 통모킹하는데, 판정 로직을 그쪽에 두면 mock 팩토리에 없어
// 호출 즉시 TypeError 가 된다. 순수 판정은 항상 여기에 둔다.
import { ISSUE_STATUSES, type IssueStatus } from './issues'

export const ISSUE_UPDATE_CATEGORIES = ['action', 'discuss', 'followup', 'etc'] as const
export type IssueUpdateCategory = (typeof ISSUE_UPDATE_CATEGORIES)[number]

/** 'note' 사람이 쓴 글 / 'status' 상태 변경 자동 기록. */
export type IssueUpdateKind = 'note' | 'status'

/** 한 건당 본문 상한. 0087 의 CHECK 제약과 같은 값이어야 한다. */
export const ISSUE_UPDATE_BODY_MAX = 4000

export const ISSUE_UPDATE_CATEGORY_META: Record<IssueUpdateCategory, { labelKey: string }> = {
  action:   { labelKey: 'issue.update.cat.action' },
  discuss:  { labelKey: 'issue.update.cat.discuss' },
  followup: { labelKey: 'issue.update.cat.followup' },
  etc:      { labelKey: 'issue.update.cat.etc' },
}

/** 화면이 쓰는 읽기 모델. archivedBy(uuid)는 화면에 내리지 않는다 — 표시는 이름으로 한다. */
export interface IssueUpdate {
  id: string
  issueId: string
  kind: IssueUpdateKind
  category: IssueUpdateCategory | null
  body: string
  mentionedMemberIds: string[]
  authorUserId: string | null
  authorName: string
  createdAt: string
  archivedAt: string | null
  archivedByName: string | null
}

export function isIssueUpdateCategory(v: unknown): v is IssueUpdateCategory {
  return typeof v === 'string' && (ISSUE_UPDATE_CATEGORIES as readonly string[]).includes(v)
}

/**
 * 취소선 처리 권한 — 이력 작성자 본인 또는 프로젝트 관리자.
 * can_edit_issue(이슈 작성자 기준)를 쓰면 안 된다. 그건 남의 코멘트를 긋는 권한이 된다.
 */
export function canArchiveUpdate(
  row: { authorUserId: string | null },
  userId: string | null,
  isProjectAdmin: boolean,
): boolean {
  if (isProjectAdmin) return true
  // 계정이 삭제되면 author_user_id 가 null 이 된다. null === null 로 통과시키면
  // 비로그인 호출이 남의 이력을 긋는다 — fail-closed.
  return userId !== null && row.authorUserId !== null && row.authorUserId === userId
}

/** 완전 삭제 권한 — 프로젝트 관리자만(is_project_admin 은 슈퍼유저를 포함한다). */
export function canPurgeUpdate(isProjectAdmin: boolean): boolean {
  return isProjectAdmin
}

/**
 * 상태 변경 자동 기록의 본문 형식. 한국어 문장을 DB 에 박으면 EN 로케일에서 번역되지 않고
 * 상태 라벨이 바뀔 때 과거 기록이 거짓말이 된다 — 기계 판독 형식으로 저장하고 화면이 렌더한다.
 */
export function encodeStatusChange(from: IssueStatus, to: IssueStatus): string {
  return `${from}>${to}`
}

export function parseStatusChange(body: string): { from: IssueStatus; to: IssueStatus } | null {
  const parts = body.split('>')
  if (parts.length !== 2) return null
  const [from, to] = parts
  const known = (v: string): v is IssueStatus => (ISSUE_STATUSES as readonly string[]).includes(v)
  if (!known(from) || !known(to)) return null
  return { from, to }
}

/**
 * 한 이름이 본문에서 차지할 수 있는 자리를 세고, 그 구간을 taken 에 등록한다.
 * 겹치는 구간은 세지 않는다 — 긴 이름이 먼저 자리를 잡으므로 짧은 이름이 그 안에
 * 파고들지 못한다(@김준기 를 @김준 으로 잘못 집는 것을 이 방식으로 막는다).
 */
function claimMentionSpans(body: string, name: string, taken: Array<[number, number]>): number {
  if (name.length === 0) return 0
  const token = `@${name}`
  let n = 0
  let i = 0
  for (;;) {
    const at = body.indexOf(token, i)
    if (at === -1) return n
    const end = at + token.length
    if (!taken.some(([s, e]) => at < e && s < end)) {
      taken.push([at, end])
      n++
    }
    i = end
  }
}

/**
 * 실제로 알림을 보낼 멘션 대상. 자동완성에서 고른 사람(picked) 중 본문에 `@이름` 이
 * 아직 남아 있는 사람만 남긴다 — 썼다 지운 멘션이 유령 알림을 보내지 않게.
 *
 * 문자열이 아니라 picked 기준으로 판정하는 이유는 두 가지다.
 *   (1) 손으로 타이핑한 `@아무개` 는 대상이 아니다(고른 적이 없으므로 id 를 모른다).
 *   (2) 동명이인이 있으면 이름만으로는 누구인지 정할 수 없다 — 등장 횟수만큼만 배정한다.
 *
 * 뒤 글자로 경계를 판정하지 않는다. 한국어는 조사·호칭이 이름에 붙어 나오므로
 * (@김준기님, @김준기가, @남순혁께) 뒤가 한글이라는 이유로 거르면 가장 자연스러운
 * 표기에서 알림이 조용히 사라진다. 대신 **긴 이름부터** 자리를 잡고 그 구간을 소비해
 * 접두사 충돌을 막는다.
 */
export function parseMentions(
  body: string,
  picked: readonly { id: string; name: string }[],
): string[] {
  const names = [...new Set(picked.map(p => p.name))].sort((a, b) => b.length - a.length)
  const taken: Array<[number, number]> = []
  const slots = new Map<string, number>()
  for (const name of names) slots.set(name, claimMentionSpans(body, name, taken))

  const used = new Map<string, number>()
  const out: string[] = []
  for (const p of picked) {
    if (out.includes(p.id)) continue
    const seen = used.get(p.name) ?? 0
    if (seen >= (slots.get(p.name) ?? 0)) continue
    used.set(p.name, seen + 1)
    out.push(p.id)
  }
  return out
}
