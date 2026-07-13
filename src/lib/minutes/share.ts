/** 외부 링크 공유 상태 전이 — 서버 액션(setMinuteShare)과 공개 라우트가 공유하는 순수 로직. */

export interface ShareState { token: string | null; enabled: boolean }
export type ShareOp = 'enable' | 'disable' | 'regenerate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 공개 라우트 토큰 형식 검증 — DB 조회 전 비정상 입력 차단. */
export function isShareToken(s: string): boolean {
  return UUID_RE.test(s)
}

/** disable 이 토큰을 보존하는 이유: 다시 켜면 같은 링크가 살아나는 구글 공유 감각. 무효화는 regenerate 로만. */
export function nextShareState(cur: ShareState, op: ShareOp, newToken: string): ShareState {
  switch (op) {
    case 'enable': return { token: cur.token ?? newToken, enabled: true }
    case 'disable': return { token: cur.token, enabled: false }
    case 'regenerate': return { token: newToken, enabled: cur.enabled }
  }
}
