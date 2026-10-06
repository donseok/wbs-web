'use client'
// 조정 팀장 자리 — 요약(lead_summary)을 중요도 순서 1~6 으로 보이는 상세와, 책상 카드에 같이 붙는 결정 대기 배지(계약 (A)).
// 문구는 leadSummaryView(순수)가 완전한 문장으로 만들어 두고 여기서는 그리기만 한다. 요약이 없으면 「요약 없음」 이다.
import type { RosterDesk } from '@/lib/domain/agentRoster'
import { buildLeadSummaryView, leadInputWaits, type LeadDecisionBadge as DecisionBadgeData } from '@/lib/domain/leadSummaryView'
import type { LeadSummary } from '@/lib/domain/watcherExtras'
import css from './seatmap.module.css'

/** 결정 대기 배지 — 책상 카드와 상세 머리가 같은 모양을 쓴다. 눌리지 않는 글자라 카드(버튼) 안에도 둘 수 있다. */
export function LeadDecisionBadge({ decision }: { decision: DecisionBadgeData }) {
  return (
    <span data-lead-decision-badge="" className={css.leadBadge}
      title={decision.firstTitle ? `첫 건: ${decision.firstTitle}` : `사용자 몫 ${decision.pendingUser}건 · 미결 ${decision.open}건`}>
      <i aria-hidden className={css.inDot} />{decision.text}
    </span>
  )
}

/** 책상 카드용 — 요약이 없거나 결정 대기가 없으면 null. */
export function leadCardBadge(summary: LeadSummary | null | undefined, nowMs: number): DecisionBadgeData | null {
  return buildLeadSummaryView(summary, nowMs)?.decision ?? null
}

export function LeadSummaryPanel({ summary, hostDesks, nowMs }: {
  summary: LeadSummary | null | undefined
  /** 같은 PC 행(같은 소유자·host)의 책상 전부 — 임시 팀원의 입력 대기를 센다. */
  hostDesks: ReadonlyArray<RosterDesk>
  nowMs: number
}) {
  const view = buildLeadSummaryView(summary, nowMs)
  const waits = leadInputWaits(hostDesks)
  return (
    <section data-lead-summary="" className={css.lead}>
      <h3 className={css.leadH}>조정 요약</h3>
      {view === null ? (
        <p data-lead-summary-none="" className={css.inMuted}>요약 없음</p>
      ) : (
        <>
          {view.decision && <LeadDecisionBadge decision={view.decision} />}
          {view.runs.length === 0 && <p data-lead-no-runs="" className={css.inMuted}>열려 있는 회차가 없습니다.</p>}
          {view.runs.map(run => (
            <div key={run.run} data-lead-run={run.run} className={css.leadRun}>
              <h4 className={css.leadRunH}>회차 {run.run}</h4>
              <ol className={css.leadList}>
                {run.items.map(it => (
                  <li key={it.id} data-lead-item={it.id} data-order={it.order} data-tone={it.tone} className={css.leadItem}>
                    <b className={css.leadLabel}>{it.order}. {it.label}</b>
                    {it.badge && <span data-lead-item-badge="" className={css.leadBadge}>{it.badge}</span>}
                    {it.lines.map((line, i) => <p key={i} className={css.leadLine}>{line}</p>)}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      )}
      <div data-lead-input-waits="" className={css.leadWaits}>
        <p data-lead-input-wait-n={waits.waiting} className={waits.waiting > 0 ? css.leadWaitN : css.inMuted}>입력 대기 {waits.waiting}건</p>
        {waits.records.length > 0 && (
          <ul data-lead-input-records="" className={css.leadRecords}>
            {waits.records.map((line, i) => <li key={i} className={css.inMuted}>{line}</li>)}
          </ul>
        )}
      </div>
    </section>
  )
}
