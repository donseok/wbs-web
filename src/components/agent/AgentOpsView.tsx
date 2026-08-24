'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { isClaimStale } from '@/lib/domain/agentWork'
import {
  approveAgentCompletion, fetchAgentOps, reclaimAgentOrder, rejectAgentCompletion,
  type AgentOpsOrder,
} from '@/app/actions/agentWork'

const COLS = ['ready', 'claimed', 'reported', 'done'] as const

/**
 * 승인 대기함(2026-08-24 축소). 등록·발행·취소는 사라졌다 — 발행은 WBS 명세 패널의 "에이전트 위임" 체크,
 * 취소는 체크 해제, 활성/중지는 프로젝트 설정. 여기 남은 건 사람만 할 수 있는 것: 보고 확인·승인·반려,
 * 응답 없는 점유의 회수.
 */
export function AgentOpsView({ projects, loadError, initialProjectId }: {
  projects: { id: string; name: string }[]
  loadError: string | null
  initialProjectId?: string
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [projectId, setProjectId] = useState(
    initialProjectId && projects.some(p => p.id === initialProjectId) ? initialProjectId : (projects[0]?.id ?? ''),
  )
  const [registered, setRegistered] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [orders, setOrders] = useState<AgentOpsOrder[]>([])
  const [error, setError] = useState<string | null>(loadError)
  const [detail, setDetail] = useState<AgentOpsOrder | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!projectId) return
    const r = await fetchAgentOps(projectId)
    if (!r.ok) { setError(r.error); return }
    setError(null)
    setRegistered(r.registered)
    setEnabled(r.enabled)
    setOrders(r.orders)
  }, [projectId])
  useEffect(() => { void reload() }, [reload])

  const byCol = useMemo(() => ({
    ready: orders.filter(o => o.status === 'ready'),
    claimed: orders.filter(o => o.status === 'claimed'),
    reported: orders.filter(o => o.status === 'reported'),
    done: orders.filter(o => o.status === 'approved' || o.status === 'cancelled'),
  }), [orders])

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    try {
      const r = await action()
      await reload()
      if (!r.ok) { toast({ title: r.error ?? t('agentops.actionFailed'), variant: 'error' }); return }
      setDetail(null)
      setRejectNote('')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{t('agentops.title')}</h1>
        <select className="app-input h-9 w-56" aria-label={t('agentops.title')} value={projectId} onChange={e => setProjectId(e.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {registered && !enabled && (
          <span className="chip bg-pending-weak text-accent-warning">{t('agentops.stoppedChip')}</span>
        )}
        {byCol.reported.length > 0 && (
          <span className="chip bg-brand-weak text-brand">{t('agentops.pendingChip')} {byCol.reported.length}</span>
        )}
      </div>
      <p className="text-sm text-ink-subtle">
        {t('agentops.desc')}{' '}
        {projectId && (
          <Link className="underline" href={`/p/${projectId}/wbs`}>{t('agentops.gotoWbs')}</Link>
        )}
      </p>
      {error && <p className="text-sm text-delayed">{t('agentops.error')}: {error}</p>}
      {!error && !registered && <EmptyState title={t('agentops.notActivated')} description={t('agentops.notActivatedDesc')} />}

      {registered && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map(col => (
            <section key={col} className={`rounded-lg border p-2 ${col === 'reported' ? 'border-brand/40' : 'border-line'}`}>
              <h2 className="mb-2 text-sm font-medium">{t(`agentops.col.${col}` as DictKey)} ({byCol[col].length})</h2>
              <div className="space-y-2">
                {byCol[col].length === 0 && <p className="text-xs text-ink-subtle">{t('agentops.empty')}</p>}
                {byCol[col].map(o => (
                  <button key={o.id} className="block w-full rounded-md border border-line p-2 text-left text-sm"
                    onClick={() => setDetail(o)}>
                    <div className="font-medium">{o.item_code} {o.item_name ?? t('agentops.itemDeleted')}</div>
                    <div className="text-xs text-ink-subtle">
                      {o.claimed_by ?? '—'}
                      {o.status === 'claimed' && isClaimStale(o.claimed_at) && (
                        <span className="ml-1 text-delayed">{t('agentops.stale')}</span>
                      )}
                      {' · '}{o.reports.at(-1)?.percent ?? 0}%
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.item_name ?? ''} size="md">
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{detail.instructions}</p>
            <h3 className="font-medium">{t('agentops.reports')}</h3>
            <ul className="space-y-2">
              {detail.reports.map(r => (
                <li key={r.id} className="rounded-md border border-line p-2">
                  <div className="text-xs text-ink-subtle">{r.created_at} · {r.agent} · {r.kind} · {r.percent}%
                    {r.review_action && ` · ${r.review_action}${r.review_note ? `: ${r.review_note}` : ''}`}</div>
                  <p className="whitespace-pre-wrap">{r.summary}</p>
                  {r.links.length > 0 && (
                    <div className="mt-1 text-xs">
                      {t('agentops.links')}: {r.links.map((l, i) => (
                        <a key={i} className="mr-2 underline" href={l.url} target="_blank" rel="noreferrer">
                          {l.label ?? l.url}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {detail.status === 'reported' && (
                <>
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => void run(() => approveAgentCompletion(detail.id))}>{t('agentops.approve')}</button>
                  <input className="app-input h-9 w-56" aria-label={t('agentops.rejectNote')} placeholder={t('agentops.rejectNote')}
                    value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
                  <button className="btn" disabled={busy || !rejectNote.trim()}
                    onClick={() => void run(() => rejectAgentCompletion(detail.id, rejectNote))}>{t('agentops.reject')}</button>
                </>
              )}
              {detail.status === 'claimed' && (
                <button className="btn" disabled={busy}
                  onClick={() => void run(() => reclaimAgentOrder(detail.id))}>{t('agentops.reclaim')}</button>
              )}
              {detail.status === 'ready' && (
                <p className="text-xs text-ink-subtle">{t('agentops.readyHint')}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
