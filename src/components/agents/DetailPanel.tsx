'use client'
import Link from 'next/link'
import type { Seat } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { STATE_LABEL } from './Seat'
import { opsFor, opSpec, type SeatOpKind } from './seatOps'
import { IconApprove, IconReject, IconResume, IconRework, IconStop, IconUnapprove } from './icons'
import css from './seatmap.module.css'

const LADDER: Array<{ phase: string; pct: number }> = [
  { phase: 'design', pct: 25 }, { phase: 'build', pct: 60 }, { phase: 'verify', pct: 85 }, { phase: 'reported', pct: 100 }, { phase: 'merged', pct: 100 },
]

const OP_ICON: Record<SeatOpKind, () => React.JSX.Element> = {
  approve: IconApprove, reject: IconReject, unapprove: IconUnapprove, rework: IconRework, stop: IconStop,
  resume: IconResume,
}

function ladderPhase(seat: Seat): string {
  if (seat.state === 'WAIT') return 'reported'
  if (seat.state === 'DONE') return 'merged'
  if (seat.phase === 'blocked' || seat.phase === 'rejected') return seat.progress < 25 ? 'design' : seat.progress < 60 ? 'build' : 'verify'
  if (seat.phase === 'refactor') return 'verify' // 사다리는 다섯 칸(스펙 §5); refactor 는 verify 칸에 놓는다
  return seat.phase
}

/** 사유를 받거나(반려·재작업) 한 번 확인받아야(중단) 확정되는 op 의 입력 상태 — 정본은 SeatmapView 가 쥔다(30초 폴링이 작성 중인 글을 지우지 않게). */
export interface NoteDraft { orderId: string; kind: SeatOpKind; text: string }

/** 모달 머리에 쓰는 한 줄 — 층 · 구역 · 주문 8자리. */
export function seatEyebrow(floorName: string, zoneLabel: string, seat: Seat): string {
  return `${floorName} · ${zoneLabel} · 주문 ${seat.id8}`
}

export function DetailPanel({ seat, floorName = '', zoneLabel = '', nowMs, busy, note, opError, onOp, onNoteChange, onNoteConfirm, onNoteCancel, onClose }: {
  seat: Seat | null; floorName?: string; zoneLabel?: string; nowMs: number
  busy: boolean
  note: NoteDraft | null
  opError: string | null
  onOp: (seat: Seat, kind: SeatOpKind) => void
  onNoteChange: (text: string) => void
  onNoteConfirm: () => void
  onNoteCancel: () => void
  /** 있으면 카드 오른쪽 위에 닫기 버튼을 그린다. */
  onClose?: () => void
}) {
  if (!seat) return null
  const now = ladderPhase(seat)
  const idx = LADDER.findIndex(l => l.phase === now)
  const hbBad = seat.state === 'STALE' || seat.state === 'OFFLINE'
  const showSignal = !['READY', 'DONE', 'WAIT'].includes(seat.state)
  const ops = opsFor(seat)
  const draft = note && note.orderId === seat.orderId ? note : null
  const draftSpec = draft ? opSpec(draft.kind) : null
  const noteReady = (draft?.text ?? '').trim().length > 0
  return (
    <div className={css.panel} data-panel="" aria-live="polite">
      <div className={css.panelHead}>
        <div className={css.eyebrow}>{floorName} · {zoneLabel} · 주문 {seat.id8}</div>
        {onClose && (
          <button type="button" className={css.panelClose} data-panel-close="" aria-label="닫기" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <h3>{seat.code}</h3>
      <p className={css.task}>{seat.name}</p>
      <span className={css.pill} data-state={seat.state}>{STATE_LABEL[seat.state]}</span>
      {/* 스텁 잔존(강제 진행 스펙 F13) — 승인이 잠긴 이유와 치울 하위 Task 로 가는 링크. */}
      {(seat.stubPending ?? []).length > 0 && (
        <p className={css.waitReason} data-stub-pending="">
          <b>스텁 잔존</b> ·{' '}
          {(seat.stubPending ?? []).map((s, i) => (
            <span key={s.subTaskId}>{i > 0 && ' · '}<Link href={`/p/${seat.projectId}/wbs?focus=${s.subTaskId}`} data-stub-link={s.subTaskId}>{s.label}</Link></span>
          ))}
        </p>
      )}
      {seat.state === 'READY' && seat.waitReason && (
        <p className={css.waitReason} data-wait-reason={seat.waitReason.kind}><b>{seat.waitReason.label}</b> · {seat.waitReason.text}</p>
      )}
      <ul className={css.ladder} aria-label="Phase">
        {LADDER.map((l, i) => (
          <li key={l.phase}
            data-done={seat.state !== 'READY' && (i < idx || (i === idx && (seat.state === 'WAIT' || seat.state === 'DONE'))) ? '1' : undefined}
            data-now={seat.state !== 'READY' && i === idx && seat.state !== 'WAIT' && seat.state !== 'DONE' ? '1' : undefined}
            data-bad={seat.rejected && i === idx ? '1' : undefined}>
            {l.phase}<br /><b>{l.pct}</b>
          </li>
        ))}
      </ul>
      <dl className={css.facts}>
        <dt>에이전트</dt><dd>{seat.agent ?? '—'}</dd>
        <dt>진행</dt><dd>{seat.progress}%</dd>
        <dt>마지막 신호</dt><dd className={hbBad ? css.factBad : ''}>{showSignal ? ageLabel(seat.lastSignalAt, nowMs) : '—'}</dd>
        <dt>heartbeat</dt><dd>{seat.heartbeatAt ? `${ageLabel(seat.heartbeatAt, nowMs)} · ${seat.heartbeatPhase ?? '—'}` : '없음(훅 미설치 또는 옛 세션)'}</dd>
        {seat.resumeRequestedAt && (
          <>
            <dt>재개 요청</dt>
            <dd data-resume-requested="">
              {ageLabel(seat.resumeRequestedAt, nowMs)} · {seat.resumeRequestedHost ?? '대상 PC 미상'} 의 팀장이 가져갑니다
            </dd>
          </>
        )}
      </dl>
      {seat.state === 'BLOCKED' && seat.note && <p className={css.quote}>{seat.note}</p>}
      {seat.rejected && <p className={css.quote}>반려 사유: {seat.reviewNote ?? '(없음)'}</p>}

      {/* 결재 — 좌석 위 결재 바와 같은 op 표를 큰 버튼으로. 사유가 필요한 op 는 아래 입력이 열린다. */}
      <div className={css.acts} role="group" aria-label="결재">
        {ops.length === 0
          ? <span className={css.actNone}>이 좌석에는 처리할 것이 없습니다.</span>
          : ops.map(({ spec, allowed, why }) => {
            const Icon = OP_ICON[spec.kind]
            return (
              <button key={spec.kind} type="button" className={css.act} data-op={spec.kind} data-panel-op={spec.kind}
                disabled={!allowed || busy} title={busy ? '처리 중입니다' : why}
                onClick={() => onOp(seat, spec.kind)}>
                <Icon />{spec.label}
              </button>
            )
          })}
      </div>
      {/* 확인이 필요한 op(중단) — 사유 입력과 같은 자리에서 한 번 더 묻는다. 브라우저 confirm() 은 쓰지 않는다. */}
      {draft && draftSpec?.needsConfirm && (
        <div className={css.noteBox} data-confirm="" data-op-confirm-box={draft.kind}>
          <p className={css.confirmText}>{draftSpec.label}할까요? {draftSpec.title}</p>
          <div className={css.noteRow}>
            <button type="button" className={css.act} data-op={draft.kind} data-op-confirm=""
              disabled={busy} onClick={onNoteConfirm}>
              {draftSpec.label} 확정
            </button>
            <button type="button" className={css.act} data-op-cancel="" onClick={onNoteCancel}>취소</button>
          </div>
        </div>
      )}
      {draft && !draftSpec?.needsConfirm && (
        <div className={css.noteBox}>
          <label htmlFor="seat-op-note">{opSpec(draft.kind).label} 사유 (필수)</label>
          <textarea id="seat-op-note" data-op-note="" rows={2} value={draft.text}
            placeholder="에이전트가 이 글을 읽고 다시 돕니다"
            onChange={e => onNoteChange(e.target.value)} />
          <div className={css.noteRow}>
            <button type="button" className={css.act} data-op={draft.kind} data-op-confirm=""
              disabled={!noteReady || busy} onClick={onNoteConfirm}>
              {opSpec(draft.kind).label} 확정
            </button>
            <button type="button" className={css.act} data-op-cancel="" onClick={onNoteCancel}>취소</button>
            <span className={css.noteHint}>{noteReady ? '서버가 사유를 받습니다' : '사유가 비면 서버가 거부합니다'}</span>
          </div>
        </div>
      )}
      {opError && <p className={css.opError} data-op-error="">{opError}</p>}

      <div className={css.actions}>
        <Link href={`/p/${seat.projectId}/wbs`}>WBS 에서 열기</Link>
      </div>
    </div>
  )
}
