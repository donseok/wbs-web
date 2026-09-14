// 에이전트 허브 — 표·큐가 공유하는 상태 라벨. 좌석표(Seat.tsx STATE_LABEL)와 뜻은 같되 관리 표에 맞춘 문구.
import type { HubOrderState } from '@/lib/domain/agentHub'

export const STATE_LABEL: Record<HubOrderState, string> = {
  READY: '대기(미착수)',
  ACTIVE: '작업 중',
  STALE: '무응답',
  OFFLINE: '끊김',
  BLOCKED: '결정 대기',
  WAIT: '승인 대기',
  REJECTED: '반려·재작업',
  DONE: '승인됨',
}

/** 주문이 없는 행의 상태 칸. */
export const NO_ORDER = '—'

export const NEEDS_DELEGATION = '위임 필요'
export const TOGGLE_DENIED_TITLE = '담당자 본인 또는 관리자만'
