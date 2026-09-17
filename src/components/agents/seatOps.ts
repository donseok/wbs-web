// src/components/agents/seatOps.ts
// 좌석에서 바로 하는 결재 — 어떤 상태에서 어떤 op 가 뜨고 누가 누를 수 있는지. IO 없는 순수 표.
// 자격은 서버 로더와 같은 축이다(src/app/actions/agentWork.ts):
//   · approve · release → loadOrderForAdmin / release 분기 = 관리자 또는 서브트리 관리자
//   · reject · unapprove · rework → loadOrderForReview = 관리자 · 리프 담당자 본인 · 서브트리 관리자
// 여기서 막는 것은 어포던스일 뿐이고 최종 판정은 서버가 한다(fail-closed는 서버 쪽).
import type { Seat } from '@/lib/domain/seatmap'
import type { SeatState } from '@/lib/domain/seatState'

export type SeatOpKind = 'approve' | 'reject' | 'unapprove' | 'rework' | 'release'

export interface SeatOpSpec {
  kind: SeatOpKind
  label: string
  /** 서버가 note 를 요구하는 op — 비면 거부한다. */
  needsNote: boolean
  /** 담당자 본인도 할 수 있는가(false 면 관리자·서브트리 관리자만). */
  assigneeMayDo: boolean
  title: string
}

const SPEC: Record<SeatOpKind, SeatOpSpec> = {
  approve: {
    kind: 'approve', label: '승인', needsNote: false, assigneeMayDo: false,
    title: '완료 보고를 승인합니다 — 단계 완료(xx) · 실적 100',
  },
  reject: {
    kind: 'reject', label: '반려', needsNote: true, assigneeMayDo: true,
    title: '완료 보고를 되돌립니다 — 단계 작업 중(ip). 에이전트가 사유를 읽고 재작업합니다',
  },
  unapprove: {
    kind: 'unapprove', label: '승인 취소', needsNote: false, assigneeMayDo: true,
    title: '승인을 무릅니다 — 승인 대기로 돌아가고 단계는 검수 대기(im)',
  },
  rework: {
    kind: 'rework', label: '재작업 요청', needsNote: true, assigneeMayDo: true,
    title: '완료(xx)를 취소하고 에이전트에게 되돌립니다 — 단계 작업 중(ip)',
  },
  release: {
    kind: 'release', label: '회수', needsNote: false, assigneeMayDo: false,
    title: '점유를 풀어 대기(미착수)로 되돌립니다. 러너는 다음 신호에서 409 를 받고 멈춥니다(최대 60초쯤 더 돕니다)',
  },
}

/** 상태마다 뜨는 op. 버튼 다섯 개를 한 줄에 놓는 설계는 실물과 맞지 않는다. */
const BY_STATE: Record<SeatState, readonly SeatOpKind[]> = {
  WAIT: ['approve', 'reject'],
  DONE: ['unapprove', 'rework'],
  ACTIVE: ['release'],
  STALE: ['release'],
  OFFLINE: ['release'],
  BLOCKED: ['release'],
  REJECTED: ['release'],
  READY: [],
}

export const ERR_NO_RIGHT = '권한이 없습니다 — 관리자 또는 서브트리 관리자만 할 수 있습니다.'
export const ERR_NO_RIGHT_REVIEW = '권한이 없습니다 — 관리자 · 담당자 본인 · 서브트리 관리자만 할 수 있습니다.'

export function mayRun(seat: Pick<Seat, 'canManage' | 'assigneeMine'>, spec: SeatOpSpec): boolean {
  return seat.canManage || (spec.assigneeMayDo && seat.assigneeMine)
}

/** 이 좌석에 그릴 결재 버튼 — 자격이 없는 것도 이유를 달아 비활성으로 남긴다(왜 못 누르는지 보여야 한다). */
export function opsFor(seat: Pick<Seat, 'state' | 'canManage' | 'assigneeMine'>): Array<{ spec: SeatOpSpec; allowed: boolean; why: string }> {
  return BY_STATE[seat.state].map(kind => {
    const spec = SPEC[kind]
    const allowed = mayRun(seat, spec)
    return { spec, allowed, why: allowed ? spec.title : (spec.assigneeMayDo ? ERR_NO_RIGHT_REVIEW : ERR_NO_RIGHT) }
  })
}

export function opSpec(kind: SeatOpKind): SeatOpSpec { return SPEC[kind] }
