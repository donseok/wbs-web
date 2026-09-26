// src/components/agents/seatOps.ts
// 좌석에서 바로 하는 결재 — 어떤 상태에서 어떤 op 가 뜨고 누가 누를 수 있는지. IO 없는 순수 표.
// 자격은 서버 로더와 같은 축이다(src/app/actions/agentWork.ts):
//   · approve · stop → loadOrderForAdmin / stop 분기 = 관리자 또는 서브트리 관리자
//   · reject · unapprove · rework → loadOrderForReview = 관리자 · 리프 담당자 본인 · 서브트리 관리자
//   · resume → stop 과 같은 분기(관리자 또는 서브트리 관리자) — 남의 PC 러너를 되살리는 관리 행위다.
// 여기서 막는 것은 어포던스일 뿐이고 최종 판정은 서버가 한다(fail-closed는 서버 쪽).
import type { Seat } from '@/lib/domain/seatmap'
import type { SeatState } from '@/lib/domain/seatState'

export type SeatOpKind = 'approve' | 'reject' | 'unapprove' | 'rework' | 'stop' | 'resume'

export interface SeatOpSpec {
  kind: SeatOpKind
  label: string
  /** 서버가 note 를 요구하는 op — 비면 거부한다. */
  needsNote: boolean
  /** 되돌리기 어려워 한 번 확인받는 op — 사유 입력과 같은 자리(상세 패널)에 확인 상자를 연다. */
  needsConfirm: boolean
  /** 담당자 본인도 할 수 있는가(false 면 관리자·서브트리 관리자만). */
  assigneeMayDo: boolean
  title: string
}

const SPEC: Record<SeatOpKind, SeatOpSpec> = {
  approve: {
    kind: 'approve', label: '승인', needsNote: false, needsConfirm: false, assigneeMayDo: false,
    title: '완료 보고를 승인합니다 — 단계 완료(xx) · 실적 100',
  },
  reject: {
    kind: 'reject', label: '반려', needsNote: true, needsConfirm: false, assigneeMayDo: true,
    title: '완료 보고를 되돌립니다 — 단계 작업 중(ip). 에이전트가 사유를 읽고 재작업합니다',
  },
  unapprove: {
    kind: 'unapprove', label: '승인 취소', needsNote: false, needsConfirm: false, assigneeMayDo: true,
    title: '승인을 무릅니다 — 승인 대기로 돌아가고 단계는 검수 대기(im)',
  },
  rework: {
    kind: 'rework', label: '재작업 요청', needsNote: true, needsConfirm: false, assigneeMayDo: true,
    title: '완료(xx)를 취소하고 에이전트에게 되돌립니다 — 단계 작업 중(ip)',
  },
  stop: {
    kind: 'stop', label: '중단', needsNote: false, needsConfirm: true, assigneeMayDo: false,
    title: '에이전트 위임을 끄고 진행 중인 개발을 멈춥니다 — 단계는 착수 전(as)으로 돌아가고, 워커는 다음 신호(약 1분 안)에서 멈춥니다',
  },
  resume: {
    kind: 'resume', label: '이어서 시작', needsNote: false, needsConfirm: false, assigneeMayDo: false,
    title: '멈춘 작업을 이어받아 달라고 팀장에게 요청합니다 — 점유는 그대로 두므로 그 PC 의 워크트리(커밋·미커밋 산출물)가 살아 있습니다',
  },
}

/** 요청이 이미 걸려 있을 때 버튼에 다는 설명 — 같은 버튼을 반복해서 누르지 않도록. */
export const RESUME_PENDING = '재개 요청됨(대기 중) — 팀장이 다음 기상(최대 30분)에 가져갑니다'

/** 상태마다 뜨는 op. 버튼 다섯 개를 한 줄에 놓는 설계는 실물과 맞지 않는다. */
const BY_STATE: Record<SeatState, readonly SeatOpKind[]> = {
  WAIT: ['approve', 'reject'],
  DONE: ['unapprove', 'rework'],
  ACTIVE: ['stop'],
  // 무응답·끊김만 재개 대상이다 — BLOCKED·REJECTED 의 러너는 살아서 사람의 답을 기다리는 중이라 되살릴 것이 없다.
  STALE: ['resume', 'stop'],
  OFFLINE: ['resume', 'stop'],
  BLOCKED: ['stop'],
  REJECTED: ['stop'],
  READY: [],
}

/** 설계 완료·선행 대기 좌석의 op. */
const DESIGN_WAIT_OPS: readonly SeatOpKind[] = ['stop']

export const ERR_NO_RIGHT = '권한이 없습니다 — 관리자 또는 서브트리 관리자만 할 수 있습니다.'
export const ERR_NO_RIGHT_REVIEW = '권한이 없습니다 — 관리자 · 담당자 본인 · 서브트리 관리자만 할 수 있습니다.'

export function mayRun(seat: Pick<Seat, 'canManage' | 'assigneeMine'>, spec: SeatOpSpec): boolean {
  return seat.canManage || (spec.assigneeMayDo && seat.assigneeMine)
}

/** 좌석 어포던스가 보는 최소 모양 — 재개 요청 표식까지 읽는다. */
export type SeatOpsInput = Pick<Seat, 'state' | 'canManage' | 'assigneeMine' | 'designWait'> & {
  resumeRequestedAt?: string | null
  /** 스텁 잔존(강제 진행 스펙 F6) — 있으면 승인을 잠그고 그 문구를 이유로 보인다(RPC 도 stub_pending 으로 거부). */
  stubPending?: Seat['stubPending']
}

/** 이 좌석에 그릴 결재 버튼 — 자격이 없는 것도 이유를 달아 비활성으로 남긴다(왜 못 누르는지 보여야 한다). */
export function opsFor(seat: SeatOpsInput): Array<{ spec: SeatOpSpec; allowed: boolean; why: string }> {
  const pending = seat.resumeRequestedAt != null
  // 설계 완료·선행 대기(스펙 2026-09-26 §6.4)는 WAIT 지만 결재할 보고가 없다 — 멈춘 개발을 끄는 중단만.
  const kinds: readonly SeatOpKind[] = seat.designWait ? DESIGN_WAIT_OPS : BY_STATE[seat.state]
  return kinds.map(kind => {
    const spec = SPEC[kind]
    // 요청이 이미 걸린 좌석의 재개 버튼은 자격이 있어도 잠근다 — 눌러 봐야 같은 값을 덮어쓸 뿐이다.
    if (kind === 'resume' && pending) return { spec, allowed: false, why: RESUME_PENDING }
    const stubs = seat.stubPending ?? []
    if (kind === 'approve' && stubs.length > 0) return { spec, allowed: false, why: stubs.map(s => s.label).join(' · ') }
    const allowed = mayRun(seat, spec)
    return { spec, allowed, why: allowed ? spec.title : (spec.assigneeMayDo ? ERR_NO_RIGHT_REVIEW : ERR_NO_RIGHT) }
  })
}

export function opSpec(kind: SeatOpKind): SeatOpSpec { return SPEC[kind] }
