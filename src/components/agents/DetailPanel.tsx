import Link from 'next/link'
import type { Seat } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { STATE_LABEL } from './Seat'
import css from './seatmap.module.css'

const LADDER: Array<{ phase: string; pct: number }> = [
  { phase: 'design', pct: 25 }, { phase: 'build', pct: 60 }, { phase: 'verify', pct: 85 }, { phase: 'reported', pct: 100 }, { phase: 'merged', pct: 100 },
]

function ladderPhase(seat: Seat): string {
  if (seat.state === 'WAIT') return 'reported'
  if (seat.state === 'DONE') return 'merged'
  if (seat.phase === 'blocked' || seat.phase === 'rejected') return seat.progress < 25 ? 'design' : seat.progress < 60 ? 'build' : 'verify'
  if (seat.phase === 'refactor') return 'verify' // 사다리는 다섯 칸(스펙 §5); refactor 는 verify 칸에 놓는다
  return seat.phase
}

export function DetailPanel({ seat, floorName, zoneLabel, nowMs }: { seat: Seat | null; floorName: string; zoneLabel: string; nowMs: number }) {
  if (!seat) return <aside className={css.panel} data-panel="">책상을 고르면 상세가 여기 보입니다.</aside>
  const now = ladderPhase(seat)
  const idx = LADDER.findIndex(l => l.phase === now)
  const hbBad = seat.state === 'STALE' || seat.state === 'OFFLINE'
  const showSignal = !['READY', 'DONE', 'WAIT'].includes(seat.state)
  return (
    <aside className={css.panel} data-panel="" aria-live="polite">
      <div className={css.eyebrow}>{floorName} · {zoneLabel} · 주문 {seat.id8}</div>
      <h3>{seat.code}</h3>
      <p className={css.task}>{seat.name}</p>
      <span className={css.pill} data-state={seat.state}>{STATE_LABEL[seat.state]}</span>
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
      </dl>
      {seat.state === 'BLOCKED' && seat.note && <p className={css.quote}>{seat.note}</p>}
      {seat.rejected && <p className={css.quote}>반려 사유: {seat.reviewNote ?? '(없음)'}</p>}
      <div className={css.actions}>
        <Link href={`/p/${seat.projectId}/wbs`}>WBS 에서 열기</Link>
      </div>
    </aside>
  )
}
