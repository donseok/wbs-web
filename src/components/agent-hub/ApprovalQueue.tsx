'use client'
// 승인 대기 큐 — 완료 보고(reported)가 올라온 주문을 카드로. 승인·반려는 관리자만(기존 agentWork 액션 재사용).
import { useState } from 'react'
import type { HubQueueEntry } from '@/lib/domain/agentHub'
import { approveAgentCompletion, rejectAgentCompletion } from '@/app/actions/agentWork'

type Props = { queue: HubQueueEntry[]; isAdmin: boolean; onChanged: () => Promise<void> | void }

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })

function QueueCard({ q, isAdmin, onChanged }: { q: HubQueueEntry; isAdmin: boolean; onChanged: Props['onChanged'] }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true); setErr(null)
    try {
      const r = await action()
      if (!r.ok) { setErr(r.error ?? '처리에 실패했습니다.'); return }
      setRejecting(false); setNote('')
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <li data-queue-card={q.orderId} className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-ink-muted">{q.code}</span>
          <span className="ml-2 text-sm font-semibold text-ink">{q.name}</span>
        </div>
        <span className="text-[11px] text-ink-subtle">{q.agent} · {when(q.reportedAt)} · {q.percent}%</span>
      </div>
      {q.summary && <p className="mt-1 whitespace-pre-wrap text-xs text-ink">{q.summary}</p>}
      {q.links.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2 text-[11px]">
          {q.links.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">{l.label ?? l.url}</a></li>)}
        </ul>
      )}
      {isAdmin ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            <button type="button" data-queue-approve disabled={busy} onClick={() => { void run(() => approveAgentCompletion(q.orderId)) }} className="btn btn-primary h-8 px-3 text-xs">승인</button>
            <button type="button" data-queue-reject-open disabled={busy} aria-expanded={rejecting} onClick={() => setRejecting(v => !v)} className="btn btn-ghost h-8 px-3 text-xs">반려</button>
          </div>
          {rejecting && (
            <div className="flex flex-col gap-1">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="반려 사유 (필수)" className="app-input w-full text-xs" />
              <div>
                <button type="button" data-queue-reject disabled={busy || note.trim() === ''} onClick={() => { void run(() => rejectAgentCompletion(q.orderId, note.trim())) }} className="btn btn-ghost h-8 px-3 text-xs">반려 확정</button>
              </div>
            </div>
          )}
        </div>
      ) : <p className="mt-2 text-[11px] text-ink-subtle">승인은 관리자가 합니다.</p>}
      {err && <p data-queue-error className="mt-1 text-[11px] text-accent-warning">{err}</p>}
    </li>
  )
}

export function ApprovalQueue({ queue, isAdmin, onChanged }: Props) {
  return (
    <section aria-label="승인 대기" className="rounded-xl border border-line bg-surface p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">승인 대기 {queue.length > 0 && <span className="ml-1 tabular-nums text-ink">{queue.length}</span>}</h2>
      {queue.length === 0
        ? <p className="text-xs text-ink-muted">승인 대기 없음</p>
        : <ul className="space-y-2">{queue.map(q => <QueueCard key={q.orderId} q={q} isAdmin={isAdmin} onChanged={onChanged} />)}</ul>}
    </section>
  )
}
