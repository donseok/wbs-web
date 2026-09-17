// 에이전트 허브 — 표·큐가 공유하는 상태 라벨. 좌석표(Seat.tsx STATE_LABEL)와 뜻은 같되 관리 표에 맞춘 문구.
import type { HubOrderState } from '@/lib/domain/agentHub'
import type { WaitReasonKind } from '@/lib/domain/waitReason'
import { STAGE_NONE_LABEL_KO } from '@/lib/domain/stageLabels'

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

/**
 * 상태 칩 색 — globals.css 의 기존 토큰만 쓴다(새 색을 만들지 않으므로 .dark 오버라이드가 그대로 따라온다).
 * 기준은 "지금 누가 손대야 하나" 다. 사람 차례(승인 대기·결정 대기·반려)는 눈에 띄게, 기계 차례
 * (작업 중·대기)는 조용하게, 끝난 것(승인됨)은 초록으로 둔다. 컴포넌트에 if (state === ...) 를
 * 흩지 않으려고 표 하나로 모은다.
 */
export const STATE_TONE: Record<HubOrderState, string> = {
  READY: 'bg-pending-weak text-pending',
  ACTIVE: 'bg-progress-weak text-progress',
  STALE: 'bg-delayed-weak text-delayed',
  OFFLINE: 'bg-surface-2 text-ink-subtle',
  BLOCKED: 'bg-pending-weak text-accent-warning',
  WAIT: 'bg-brand-weak text-brand',
  REJECTED: 'bg-delayed-weak text-delayed',
  DONE: 'bg-done-weak text-done',
}

/**
 * 착수 대기 사유 칩 색(waitReason.ts 의 네 종류). 위 둘은 사람이 움직여야 풀리고, 아래 둘은
 * 시간이 지나면 저절로 풀린다 — 색이 그 차이를 말한다.
 */
export const REASON_TONE: Record<WaitReasonKind, string> = {
  dependency: 'bg-delayed-weak text-delayed',
  agent_off: 'bg-pending-weak text-accent-warning',
  agents_busy: 'bg-progress-weak text-progress',
  pickup: 'bg-pending-weak text-pending',
}

/** 위임이 안 된 개발 리프 — 사유 칩과 같은 자리에 같은 모양으로 둔다(사람이 체크를 켜야 풀린다). */
export const NEEDS_DELEGATION_TONE = 'bg-pending-weak text-accent-warning'

/** 주문이 없는 행의 상태 칸. */
export const NO_ORDER = '—'

export const NEEDS_DELEGATION = '위임 필요'
export const TOGGLE_DENIED_TITLE = '담당자 본인 또는 관리자만'

/** 단계 select 의 순서와 문구(§11) — 정본은 src/lib/domain/stageLabels.ts(스펙 2026-09-15 §3.2, fp 제거). */
export { STAGE_CODES } from '@/lib/domain/stageLabels'
export const STAGE_NONE_LABEL = STAGE_NONE_LABEL_KO

/** 조정 버튼 문구·설명(§11). 문구는 WBS 상세 패널(wbs.agentOrder*)과 같게 둔다 — 같은 행위에 다른 이름을 주지 않는다. */
export const OP_LABEL = {
  approve: '승인',
  reject: '반려',
  unapprove: '승인 취소',
  rework: '재작업 요청',
  release: '회수',
} as const
export const OP_TITLE = {
  approve: '완료 보고를 승인합니다 — 단계 완료(xx)·실적 100',
  reject: '완료 보고를 되돌립니다 — 단계 작업 중(ip)·실적은 크레딧 표의 반려·재작업(RW) 값, 에이전트가 사유를 읽고 재작업(사유 필수)',
  unapprove: '승인을 무릅니다 — 승인 대기로 돌아가고 단계 검수 대기(im)·실적은 크레딧 표의 IM 값',
  rework: '완료(xx)를 취소하고 에이전트에게 되돌립니다 — 단계 작업 중(ip)·실적은 크레딧 표의 RW 값(사유 필수)',
  release: '점유를 풀어 대기(미착수)로 되돌립니다 — 단계 할당됨(as)·실적은 크레딧 표의 AS 값. 러너는 다음 신호에서 409 를 받고 멈춥니다',
} as const
export const NOTE_PLACEHOLDER = { reject: '반려 사유 (필수)', rework: '재작업 사유 (필수)' } as const

/** 위임 체크박스 안내(§11-2 개정). 취소는 체크를 끄는 것 하나로 통일 — 켜기/끄기 뜻을 툴팁으로 명시한다. */
export const DELEGATE_ON_TITLE = '체크하면 이 작업을 에이전트에 위임합니다.'
export const DELEGATE_OFF_TITLE = '체크를 끄면 위임이 해제되고, 아직 시작 안 된 대기 주문은 취소됩니다.'
