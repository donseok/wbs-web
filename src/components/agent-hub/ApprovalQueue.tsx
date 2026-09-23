'use client'
// 승인 대기 큐 — 완료 보고(reported)가 올라온 주문을 카드로. 승인은 관리자 또는 서브트리 관리자
// (대상 리프의 strict 조상 중 담당자가 나, HubQueueEntry.canManage — 트랙 B, 2026-09-15).
// 처리는 runHubProcessOp 1건으로 끝나고 응답의 허브로 화면을 바꾼다(§10·§11) — 재조회 요청 없음.
import { useState } from 'react'
import type { AgentHub, HubQueueEntry } from '@/lib/domain/agentHub'
import { runHubProcessOp, type HubProcessOp } from '@/app/actions/agentHub'
import { NOTE_PLACEHOLDER, OP_LABEL, OP_TITLE } from './labels'
import { DecisionList } from './DecisionList'

type Props = {
  queue: HubQueueEntry[]
  projectId: string
  isAdmin: boolean
  /** 처리 응답의 허브로 화면 교체. */
  onHub: (hub: AgentHub) => void
  /** 처리는 됐는데 재조회만 실패했을 때의 재시도(refreshAgentHub 1회). */
  onChanged: () => Promise<void> | void
}

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
/** 결정이 딸린 보고의 반려 안내 — 결정별 반려(스펙 §11)의 토대. 가드·동작은 바꾸지 않는다. */
const REJECT_DECISION_PLACEHOLDER = '반려 사유 — 특정 결정이면 번호를 적어 주세요(예: D2 는 선택지 2로)'

function QueueCard({ q, projectId, isAdmin, onHub, onChanged }: { q: HubQueueEntry } & Omit<Props, 'queue'>) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const run = async (op: HubProcessOp) => {
    setBusy(true); setErr(null); setWarn(null)
    try {
      const r = await runHubProcessOp(projectId, op)
      if (!r.ok) { setErr(r.error); return }
      if (r.warning) setWarn(r.warning)
      setRejecting(false); setNote('')
      if (r.hub) onHub(r.hub)
      else { setErr(r.hubError ?? '현황 재조회에 실패했습니다.'); await onChanged() }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const decisionN = q.decisions.state === 'ok' ? q.decisions.items.length : 0
  return (
    <li data-queue-card={q.orderId} className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-ink-muted">{q.code}</span>
          <span className="ml-2 text-sm font-semibold text-ink">{q.name}</span>
        </div>
        <span className="flex items-center gap-1.5">
          {decisionN > 0 && (
            <span data-queue-decision-chip title="워커가 스스로 고른 결정 — 아래 목록을 확인하세요"
              className="rounded-full bg-accent-warning/15 px-1.5 text-[10px] font-semibold text-accent-warning">결정 {decisionN}</span>
          )}
          <span className="text-[11px] text-ink-subtle">{q.agent} · {when(q.reportedAt)} · {q.percent}%</span>
        </span>
      </div>
      {q.summary && <p className="mt-1 whitespace-pre-wrap text-xs text-ink">{q.summary}</p>}
      {/* 승인자의 일이 이것을 읽는 것이라 접지 않는다(과제 C). */}
      <DecisionList decisions={q.decisions} />
      {q.links.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2 text-[11px]">
          {q.links.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">{l.label ?? l.url}</a></li>)}
        </ul>
      )}
      {(isAdmin || q.assigneeMine || q.canManage) ? (
        // 승인은 관리자 또는 서브트리 관리자, 반려는 +담당자 본인도(2026-09-14 §11, 2026-09-15 트랙 B).
        // 담당자는 자기 완료 보고를 스스로 물릴 수 있다. canManage 는 조상 전용이라 리프 본인 담당자만인
        // 경우엔 여전히 approve 가 안 뜬다(분리 원칙 — 자기 완료를 자기가 승인 못 함).
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            {(isAdmin || q.canManage) && (
              <button type="button" data-queue-approve disabled={busy} title={OP_TITLE.approve}
                onClick={() => { void run({ kind: 'approve', orderId: q.orderId }) }} className="btn btn-primary h-8 px-3 text-xs">{OP_LABEL.approve}</button>
            )}
            <button type="button" data-queue-reject-open disabled={busy} aria-expanded={rejecting} title={OP_TITLE.reject}
              onClick={() => setRejecting(v => !v)} className="btn btn-ghost h-8 px-3 text-xs">{OP_LABEL.reject}</button>
          </div>
          {!(isAdmin || q.canManage) && <p className="text-[10px] text-ink-subtle">승인은 관리자가 합니다. 담당자는 반려로 자기 보고를 물릴 수 있습니다.</p>}
          {rejecting && (
            <div className="flex flex-col gap-1">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={decisionN > 0 ? REJECT_DECISION_PLACEHOLDER : NOTE_PLACEHOLDER.reject} className="app-input w-full text-xs" />
              <div>
                <button type="button" data-queue-reject disabled={busy || note.trim() === ''}
                  onClick={() => { void run({ kind: 'reject', orderId: q.orderId, note: note.trim() }) }} className="btn btn-ghost h-8 px-3 text-xs">반려 확정</button>
              </div>
            </div>
          )}
        </div>
      ) : <p className="mt-2 text-[11px] text-ink-subtle">승인은 관리자가 합니다.</p>}
      {err && <p data-queue-error className="mt-1 text-[11px] text-accent-warning">{err}</p>}
      {warn && <p data-queue-warning className="mt-1 text-[11px] text-pending">{warn}</p>}
    </li>
  )
}

export function ApprovalQueue({ queue, ...rest }: Props) {
  return (
    <section aria-label="승인 대기" className="rounded-xl border border-line bg-surface p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">승인 대기 {queue.length > 0 && <span className="ml-1 tabular-nums text-ink">{queue.length}</span>}</h2>
      {queue.length === 0
        ? <p className="text-xs text-ink-muted">승인 대기 없음</p>
        : <ul className="space-y-2">{queue.map(q => <QueueCard key={q.orderId} q={q} {...rest} />)}</ul>}
    </section>
  )
}
