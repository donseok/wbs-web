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

/** 단계 select 의 순서와 문구(§11). 값은 wbs_items.stage 코드, 문구는 waitReason.STAGE_LABEL 과 같다. */
export const STAGE_CODES = ['as', 'fp', 'ip', 'im', 'xx'] as const
export const STAGE_NONE_LABEL = '미지정'

/** 조정 버튼 문구·설명(§11). 문구는 WBS 상세 패널(wbs.agentOrder*)과 같게 둔다 — 같은 행위에 다른 이름을 주지 않는다. */
export const OP_LABEL = {
  approve: '승인',
  reject: '반려',
  unapprove: '승인 취소',
  rework: '재작업 요청',
  release: '회수',
} as const
export const OP_TITLE = {
  approve: '완료 보고를 승인합니다 — 실적 100%, 단계 완료(xx)',
  reject: '완료 보고를 되돌립니다 — 에이전트가 사유를 읽고 재작업(사유 필수)',
  unapprove: '승인을 무릅니다 — 승인 대기로 돌아가고 실적·단계를 되돌립니다',
  rework: '완료(xx)를 취소하고 에이전트에게 되돌립니다 — 재작업(사유 필수)',
  release: '점유를 풀어 대기(미착수)로 되돌립니다 — 러너는 다음 신호에서 409 를 받고 멈춥니다',
} as const
export const NOTE_PLACEHOLDER = { reject: '반려 사유 (필수)', rework: '재작업 사유 (필수)' } as const

/** READY 주문 취소 버튼(§11-2). 위임 해제(applyDelegation(false))와 같은 동작이라 별도 서버 op 가 아니다. */
export const CANCEL_LABEL = '취소'
export const CANCEL_TITLE = '위임을 해제해 이 대기 주문을 취소합니다 — 위임 체크를 끄는 것과 같습니다.'
