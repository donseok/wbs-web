// src/components/agents/SeatOpsBar.tsx
'use client'
import type { Seat } from '@/lib/domain/seatmap'
import { opsFor, type SeatOpKind } from './seatOps'
import { IconApprove, IconReject, IconRelease, IconResume, IconRework, IconUnapprove } from './icons'
import css from './seatmap.module.css'

const OP_ICON: Record<SeatOpKind, () => React.JSX.Element> = {
  approve: IconApprove, reject: IconReject, unapprove: IconUnapprove, rework: IconRework, release: IconRelease,
  resume: IconResume,
}

export interface SeatOpHandler {
  /** 누른 op 를 실행한다. 사유가 필요한 op 는 곧바로 실행하지 않고 상세 패널의 사유 입력을 연다. */
  (seat: Seat, kind: SeatOpKind): void
}

/**
 * 좌석 위 결재 바 — 늘 보인다. display 를 토글해 꺼내지 않는다(globals.css 안전망에 진다).
 * op 가 없는 좌석(빈자리)에는 아예 그리지 않는다.
 */
export function SeatOpsBar({ seat, busy, onOp }: { seat: Seat; busy: boolean; onOp: SeatOpHandler }) {
  const ops = opsFor(seat)
  if (ops.length === 0) return null
  return (
    <div className={css.seatOps} role="group" aria-label={`${seat.code} 결재`}>
      {ops.map(({ spec, allowed, why }) => {
        const Icon = OP_ICON[spec.kind]
        return (
          <button key={spec.kind} type="button" className={css.opMini} data-op={spec.kind} data-seat-op={spec.kind}
            disabled={!allowed || busy} title={busy ? '처리 중입니다' : why}
            aria-label={`${seat.code} ${spec.label}`}
            onClick={() => onOp(seat, spec.kind)}>
            <Icon />{spec.label}
          </button>
        )
      })}
    </div>
  )
}
