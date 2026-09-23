'use client'
// 작업 정보 사이드바 「강제 진행」 절(스펙 §3.2·§3.6). 간선마다 면제·해제, 아래에 스텁 잔존 목록.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ComputedItem } from '@/lib/domain/types'
import { WAIVE_BLOCK_TEXT, lastRefSegment, pendingStubs, stubLabel, waiveBlock } from '@/lib/domain/forceProgress'
import { cancelStubTask, setDependencyWaiver } from '@/app/actions/forceProgress'

type Props = { item: ComputedItem; itemByRef: ReadonlyMap<string, ComputedItem>; editable: boolean; onSelectItem?: (id: string) => void }

export function ForceProgressSection({ item, itemByRef, editable, onSelectItem }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<{ ref: string; waive: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const depends = item.depends ?? []
  const waived = item.dependsWaived ?? []
  const stubs = pendingStubs((item.subTasks ?? []).filter(s => s.stubFor).map(s => ({ id: s.id, stubFor: s.stubFor as string, externalRef: s.externalRef ?? null, stage: s.stage ?? null })))
  if (depends.length === 0 && stubs.length === 0) return null

  const submit = async () => {
    if (!open) return
    setBusy(true); setMsg(null)
    try {
      const r = await setDependencyWaiver(item.id, open.ref, open.waive, reason)
      if (!r.ok) setMsg(r.error)
      else { setMsg(r.warning ?? null); setOpen(null); setReason(''); router.refresh() }
    } finally { setBusy(false) }
  }

  return (
    <section data-force-progress className="space-y-2">
      <div className="text-[11px] font-semibold text-ink-muted">강제 진행</div>
      <ul className="space-y-1.5">
        {depends.map(ref => {
          const p = itemByRef.get(ref)
          const isWaived = waived.includes(ref)
          const block = isWaived ? null : waiveBlock({
            successor: { externalRef: item.externalRef ?? null, depends, dependsWaived: waived, stubFor: item.stubFor ?? null, hasNormalChildren: item.children.length > 0 },
            predRef: ref,
            pred: p ? { stage: p.stage ?? null, orderApproved: false, actualPct: p.rolledActualPct, hasContract: p.hasContract === true } : null,
          })
          if (block === 'already_reached') return null
          return (
            <li key={ref} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{p ? `${p.code} ${p.name}` : lastRefSegment(ref)}</span>
              {isWaived && <span className="chip shrink-0 text-[10px]">면제됨</span>}
              {editable && (isWaived
                ? <button type="button" className="btn h-6 px-2 text-[11px]" disabled={busy} data-unwaive={ref} onClick={() => setOpen({ ref, waive: false })}>면제 해제</button>
                : <button type="button" className="btn h-6 px-2 text-[11px]" disabled={busy || block !== null} title={block ? WAIVE_BLOCK_TEXT[block] : undefined}
                    data-waive={ref} onClick={() => setOpen({ ref, waive: true })}>강제 진행</button>)}
              {!isWaived && block !== null && <span data-waive-block className="shrink-0 text-[10px] text-ink-subtle">{WAIVE_BLOCK_TEXT[block]}</span>}
            </li>
          )
        })}
      </ul>
      {open && (
        <div className="space-y-1 rounded-lg border border-line p-2">
          <p className="text-[11px] text-ink-muted">
            {open.waive
              ? '이 선행을 기다리지 않고 스텁으로 먼저 개발합니다. 스텁 제거 작업이 하위에 생기고, 그 작업이 끝날 때까지 이 작업의 승인은 잠깁니다. 개발 브랜치가 운영 브랜치와 같으면(개발 브랜치 미설정) 스텁이 운영에 들어갈 수 있으니 확인하세요.'
              : '면제를 풉니다. 이미 만든 스텁 제거 작업은 남습니다 — 스텁이 없다면 아래 목록에서 취소하세요.'}
          </p>
          <input data-waive-reason aria-label="강제 진행 사유" className="app-input h-7 w-full text-xs" value={reason} onChange={e => setReason(e.target.value)} placeholder="사유(필수)" />
          <div className="flex gap-1.5">
            <button type="button" data-waive-confirm className="btn btn-primary h-7 px-2.5 text-xs" disabled={busy || reason.trim() === ''} onClick={() => void submit()}>
              {open.waive ? '강제 진행 확정' : '면제 해제 확정'}
            </button>
            <button type="button" className="btn h-7 px-2.5 text-xs" disabled={busy} onClick={() => { setOpen(null); setReason('') }}>취소</button>
          </div>
        </div>
      )}
      {stubs.length > 0 && (
        <ul className="space-y-1">
          {stubs.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <button type="button" data-stub-link={s.id} className="min-w-0 flex-1 truncate text-left font-semibold text-delayed underline-offset-2 hover:underline"
                onClick={() => onSelectItem?.(s.id)}>{stubLabel(s.stubFor)}</button>
              {editable && (
                <button type="button" data-stub-cancel={s.id} className="btn h-6 px-2 text-[11px]" disabled={busy}
                  onClick={async () => { setBusy(true); try { const r = await cancelStubTask(s.id); setMsg(r.ok ? null : r.error ?? null); if (r.ok) router.refresh() } finally { setBusy(false) } }}>
                  스텁 제거 작업 취소
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role="status" className="text-[11px] text-delayed">{msg}</p>}
    </section>
  )
}
