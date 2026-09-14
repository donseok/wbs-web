'use client'
// 위임 표 — WBS 트리 순서로 항목을 나열하고 리프마다 위임 체크·단계·주문 상태·에이전트·마지막 신호·조정·프롬프트.
// 부모 행 체크 = 하위 리프 일괄(관리자). 체크는 즉시 표시되고 잠기지 않는다. 1.5초 모아 applyHubDelegations 1건으로
// 보내고 응답의 허브로 표를 갱신한다(2026-09-14 체크 지연 개선 — 종전 체크 1개 = 액션 2건 직렬 + 0.8~1.0초 잠김).
// 조정(승인·반려·승인 취소·재작업 요청·회수)과 단계 직접 조정은 관리자만, runHubProcessOp 1건으로 끝나고 응답의 허브로
// 교체한다(스펙 §11). 페이지 전체 refresh 금지(스펙 §7).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { AgentHub, HubRow } from '@/lib/domain/agentHub'
import { ageLabel } from '@/lib/domain/seatmap'
import { STAGE_LABEL } from '@/lib/domain/waitReason'
import { updateAgentPrompt } from '@/app/actions/wbsSpec'
import { applyHubDelegations, runHubProcessOp, type HubDelegationsResult, type HubProcessOp, type WbsStageCode } from '@/app/actions/agentHub'
import { PendingSaveChip } from '@/components/wbs/PendingSaveChip'
import { usePendingDelegations } from './usePendingDelegations'
import {
  NEEDS_DELEGATION, NO_ORDER, NOTE_PLACEHOLDER, OP_LABEL, OP_TITLE, STAGE_CODES, STAGE_NONE_LABEL, STATE_LABEL, TOGGLE_DENIED_TITLE,
} from './labels'

export type HubFilter = 'mine' | 'all'

type Props = {
  rows: HubRow[]
  projectId: string
  isAdmin: boolean
  filter: HubFilter
  onFilter: (f: HubFilter) => void
  nowMs: number
  /** 묶음 저장·조정 응답에 실린 허브로 화면을 교체한다 — 재조회 요청 없음. */
  onHub: (hub: AgentHub) => void
  /** 재조회가 필요한 변경(프롬프트 저장, 저장 뒤 재조회 실패) — refreshAgentHub 1회. */
  onChanged: () => Promise<void> | void
}

type NoteKind = 'reject' | 'rework'
/**
 * 주문 상태별 조정 버튼(§11). note 가 있는 것은 사유 입력 줄을 먼저 연다.
 * who='admin' 은 관리자만(승인·회수), 'review' 는 관리자 또는 담당자 본인(반려·승인 취소·재작업 요청,
 * 2026-09-14 사용자 결정 "담당자 본인도 허용"). 서버 자격(loadOrderForReview·runHubProcessOp)과 같은 경계다.
 */
type OpButton = { kind: keyof typeof OP_LABEL; who: 'admin' | 'review'; note?: NoteKind }
const OPS_BY_STATUS: Readonly<Record<string, readonly OpButton[]>> = {
  reported: [{ kind: 'approve', who: 'admin' }, { kind: 'reject', who: 'review', note: 'reject' }],
  approved: [{ kind: 'unapprove', who: 'review' }, { kind: 'rework', who: 'review', note: 'rework' }],
  claimed: [{ kind: 'release', who: 'admin' }],
}

/** 부모 → 자손 리프(마일스톤 제외) id. 표 행이 전위 순서라 stack 없이 한 번에 만든다. */
function leafDescendants(rows: HubRow[]): Map<string, string[]> {
  const parentOf = new Map(rows.map(r => [r.itemId, r.parentId]))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.isLeaf || r.milestone) continue
    let p = r.parentId
    while (p) { const l = out.get(p); if (l) l.push(r.itemId); else out.set(p, [r.itemId]); p = parentOf.get(p) ?? null }
  }
  return out
}

function ParentCheckbox({ state, onClick }: { state: 'all' | 'some' | 'none'; onClick: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some' }, [state])
  return (
    <input ref={ref} type="checkbox" data-hub-parent-toggle checked={state === 'all'}
      aria-label="하위 리프 전체 위임" title="하위 리프 전체 위임/해제" onChange={onClick} className="h-3.5 w-3.5 rounded border-line" />
  )
}

export function DelegationTable({ rows, projectId, isAdmin, filter, onFilter, nowMs, onHub, onChanged }: Props) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  // 프롬프트 저장·조정 처리 중인 행 — 체크는 잠그지 않으므로 여기에 들어가지 않는다.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const [rowErr, setRowErr] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [rowWarn, setRowWarn] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // 사유가 필요한 조정(반려·재작업)의 입력 줄. 한 번에 하나만 연다.
  const [noteOp, setNoteOp] = useState<{ itemId: string; orderId: string; kind: NoteKind } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  // 단계 select 의 낙관 표시 — 응답(성공·실패)이 오면 지운다. 실패면 서버값으로 돌아간다.
  const [stageOpt, setStageOpt] = useState<ReadonlyMap<string, string | null>>(() => new Map())

  const byId = useMemo(() => new Map(rows.map(r => [r.itemId, r])), [rows])
  const leaves = useMemo(() => leafDescendants(rows), [rows])
  const serverValues = useMemo(() => new Map(rows.filter(r => r.isLeaf).map(r => [r.itemId, r.delegated] as const)), [rows])

  const pend = usePendingDelegations<HubDelegationsResult>({
    serverValues,
    commit: changes => applyHubDelegations(projectId, changes),
    onResult: (res, sent) => {
      if (!res.ok) {
        // 묶음 전체 거부(가드·입력·타 프로젝트) — 보낸 행마다 같은 문구. 대기는 훅이 비워 서버값으로 돌아가 있다.
        setRowErr(m => { const n = new Map(m); for (const c of sent) n.set(c.itemId, res.error); return n })
        return
      }
      setRowErr(m => { const n = new Map(m); for (const c of sent) n.delete(c.itemId); for (const f of res.failed) n.set(f.itemId, f.error); return n })
      setRowWarn(m => { const n = new Map(m); for (const c of sent) n.delete(c.itemId); for (const w of res.warnings) n.set(w.itemId, w.warning); return n })
      setNotice(res.failed.length > 1
        ? `${res.failed.length}건 실패: ${res.failed.map(f => byId.get(f.itemId)?.code ?? f.itemId).join(', ')}`
        : res.hubError ?? null)
      if (res.hub) onHub(res.hub)
      else void onChanged() // 저장은 됐고 재조회만 실패 — 한 번 더 시도한다.
    },
    onError: (message, sent) => setRowErr(m => { const n = new Map(m); for (const c of sent) n.set(c.itemId, message); return n }),
  })

  // 표시 행: mine 이면 내 담당 리프와 그 조상만. 접힌 부모의 자손은 숨긴다.
  const visible = useMemo(() => {
    let keep: Set<string> | null = null
    if (filter === 'mine') {
      keep = new Set()
      for (const r of rows) {
        if (!(r.isLeaf && r.assigneeMine)) continue
        keep.add(r.itemId)
        let p = r.parentId
        while (p) { keep.add(p); p = byId.get(p)?.parentId ?? null }
      }
    }
    const out: HubRow[] = []
    for (const r of rows) {
      if (keep && !keep.has(r.itemId)) continue
      let hidden = false
      let p = r.parentId
      while (p) { if (folded.has(p)) { hidden = true; break } p = byId.get(p)?.parentId ?? null }
      if (!hidden) out.push(r)
    }
    return out
  }, [rows, filter, folded, byId])

  const mapWith = <V,>(m: ReadonlyMap<string, V>, k: string, v: V | null) => { const n = new Map(m); if (v === null) n.delete(k); else n.set(k, v); return n }
  const setWith = (s: ReadonlySet<string>, k: string, on: boolean) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n }

  const toggleLeaf = (r: HubRow) => {
    setRowErr(m => mapWith(m, r.itemId, null)); setRowWarn(m => mapWith(m, r.itemId, null))
    pend.set(r.itemId, !pend.value(r.itemId))
  }

  const toggleParent = (r: HubRow) => {
    const ids = leaves.get(r.itemId) ?? []
    if (ids.length === 0) return
    const allOn = ids.every(id => pend.value(id))
    setNotice(null)
    pend.setMany(ids.map(id => [id, !allOn] as const))
  }

  const savePrompt = async (r: HubRow) => {
    setBusy(s => setWith(s, r.itemId, true)); setRowErr(m => mapWith(m, r.itemId, null))
    try {
      const res = await updateAgentPrompt(r.itemId, draft)
      if (!res.ok) { setRowErr(m => mapWith(m, r.itemId, res.error ?? '실패')); return }
      setEditing(null)
      await onChanged()
    } catch (e) {
      setRowErr(m => mapWith(m, r.itemId, e instanceof Error ? e.message : String(e)))
    } finally { setBusy(s => setWith(s, r.itemId, false)) }
  }

  /** 조정 1건 — 요청 1건, 응답의 허브로 교체. 실패·경고는 그 행 아래에. */
  const runOp = async (r: HubRow, op: HubProcessOp) => {
    setBusy(s => setWith(s, r.itemId, true)); setRowErr(m => mapWith(m, r.itemId, null)); setRowWarn(m => mapWith(m, r.itemId, null))
    try {
      const res = await runHubProcessOp(projectId, op)
      if (!res.ok) { setRowErr(m => mapWith(m, r.itemId, res.error)); return }
      if (res.warning) setRowWarn(m => mapWith(m, r.itemId, res.warning ?? null))
      if (noteOp?.itemId === r.itemId) { setNoteOp(null); setNoteDraft('') }
      if (res.hub) onHub(res.hub)
      else { setNotice(res.hubError ?? null); await onChanged() }
    } catch (e) {
      setRowErr(m => mapWith(m, r.itemId, e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(s => setWith(s, r.itemId, false))
      setStageOpt(m => mapWith(m, r.itemId, null))
    }
  }

  const changeStage = (r: HubRow, raw: string) => {
    const stage = (raw || null) as WbsStageCode | null
    setStageOpt(m => { const n = new Map(m); n.set(r.itemId, stage); return n })
    void runOp(r, { kind: 'stage', itemId: r.itemId, stage })
  }

  const parentState = (r: HubRow): 'all' | 'some' | 'none' => {
    const ids = leaves.get(r.itemId) ?? []
    const on = ids.filter(id => pend.value(id)).length
    return on === 0 ? 'none' : on === ids.length ? 'all' : 'some'
  }

  const seg = (f: HubFilter, label: string) => (
    <button type="button" data-hub-filter={f} aria-pressed={filter === f} onClick={() => onFilter(f)}
      className={`rounded-md px-2 py-1 text-xs ${filter === f ? 'bg-brand-weak text-brand' : 'text-ink-muted hover:bg-surface-2'}`}>{label}</button>
  )

  return (
    <section aria-label="위임 표" className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="표시 범위">{seg('mine', '내 담당')}{seg('all', '전체')}</div>
          {(pend.isPending || pend.saving) && (
            <span data-hub-pending className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
              <span data-hub-pending-count>{pend.count}건</span>
              <PendingSaveChip isPending={pend.isPending} saving={pend.saving} remainingMs={pend.remainingMs} onSaveNow={() => { void pend.flush() }} />
            </span>
          )}
        </div>
        <span className="text-[11px] text-ink-subtle">리프 항목의 체크가 위임(발행)입니다. 부모 체크는 하위 전체(관리자).</span>
      </div>
      {notice && <p data-hub-notice role="status" className="mb-2 rounded-md bg-pending-weak px-2 py-1 text-xs text-pending">{notice}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-subtle">
              <th className="w-8 py-1">위임</th><th className="w-40 py-1">코드</th><th className="py-1">이름</th><th className="w-24 py-1">담당자</th>
              <th className="w-24 py-1">단계</th><th className="w-28 py-1">상태</th><th className="w-32 py-1">에이전트</th><th className="w-20 py-1">마지막 신호</th>
              <th className="w-40 py-1">조정</th><th className="w-44 py-1">프롬프트</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const checked = pend.value(r.itemId)
              const isBusy = busy.has(r.itemId)
              const err = rowErr.get(r.itemId), warn = rowWarn.get(r.itemId)
              const canEditPrompt = r.canToggle
              const sig = r.order?.lastSignalAt ? ageLabel(r.order.lastSignalAt, nowMs) : ''
              const stageShown = stageOpt.has(r.itemId) ? stageOpt.get(r.itemId) ?? null : r.stage
              // 단계 select 는 관리자만. 조정 버튼은 관리자 + 담당자 본인이 볼 수 있고, 버튼별 who 로 다시 거른다.
              const canStage = isAdmin && r.isLeaf && !r.milestone
              const canReviewRow = (isAdmin || r.assigneeMine) && r.isLeaf && !r.milestone
              const ops = canReviewRow && r.order
                ? (OPS_BY_STATUS[r.order.status] ?? []).filter(b => b.who === 'admin' ? isAdmin : (isAdmin || r.assigneeMine))
                : []
              const noteOpen = noteOp?.itemId === r.itemId ? noteOp : null
              return [
                <tr key={r.itemId} data-hub-row={r.itemId} className="border-t border-line align-middle">
                  <td className="py-1">
                    {r.isLeaf
                      ? <input type="checkbox" data-hub-toggle checked={checked} disabled={!r.canToggle}
                          title={r.canToggle ? undefined : TOGGLE_DENIED_TITLE} aria-label={`${r.code} 위임`}
                          onChange={() => toggleLeaf(r)} className="h-3.5 w-3.5 rounded border-line" />
                      : (isAdmin && (leaves.get(r.itemId)?.length ?? 0) > 0)
                        ? <ParentCheckbox state={parentState(r)} onClick={() => toggleParent(r)} />
                        : null}
                  </td>
                  <td className="py-1 font-mono text-[11px] text-ink-muted">{r.code}</td>
                  <td className="py-1">
                    <span data-hub-name style={{ paddingLeft: `${r.depth * 16}px` }} className="inline-flex items-center gap-1">
                      {!r.isLeaf && (
                        <button type="button" data-hub-fold aria-expanded={!folded.has(r.itemId)} aria-label={`${r.code} 접기/펼치기`}
                          onClick={() => setFolded(s => setWith(s, r.itemId, !s.has(r.itemId)))} className="text-ink-subtle hover:text-ink">
                          {folded.has(r.itemId) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <span className={r.isLeaf ? 'text-ink' : 'font-semibold text-ink'}>{r.name}</span>
                    </span>
                  </td>
                  <td className="py-1 text-ink-muted">{r.assigneeName ?? ''}</td>
                  <td className="py-1">
                    {canStage
                      ? <select data-hub-stage value={stageShown ?? ''} disabled={isBusy} aria-label={`${r.code} 단계`}
                          title="단계 직접 조정 — 진행 중 주문이 있으면 구현(im)·완료(xx)는 승인으로만 갑니다"
                          onChange={e => changeStage(r, e.target.value)} className="app-input h-7 py-0 text-[11px]">
                          <option value="">{STAGE_NONE_LABEL}</option>
                          {STAGE_CODES.map(c => <option key={c} value={c}>{STAGE_LABEL[c]}</option>)}
                        </select>
                      : r.isLeaf && !r.milestone
                        ? <span data-hub-stage-text className="text-ink-muted">{r.stage ? STAGE_LABEL[r.stage] ?? r.stage : STAGE_NONE_LABEL}</span>
                        : null}
                  </td>
                  <td className="py-1">
                    {r.order ? <span className="chip bg-surface-2 text-ink">{STATE_LABEL[r.order.state]}</span> : <span className="text-ink-subtle">{NO_ORDER}</span>}
                    {r.isLeaf && r.devWorkflow && !r.delegated && <small className="ml-1 text-[10px] text-accent-warning">{NEEDS_DELEGATION}</small>}
                    {r.unmetDepends && (
                      <small data-hub-depends className="block text-[10px] text-accent-warning"
                        title={`선행 작업이 아직 끝나지 않았습니다: ${r.unmetDepends}. 선행이 im(구현) 단계 이상이 되거나 그 주문이 승인돼야 에이전트가 집어갑니다.`}>
                        선행 미완료: {r.unmetDepends}
                      </small>
                    )}
                  </td>
                  <td className="py-1 text-ink-muted">{r.order?.agent ?? ''}</td>
                  <td className="py-1 text-ink-subtle">{sig}</td>
                  <td className="py-1">
                    {ops.length > 0 && (
                      <span className="inline-flex flex-wrap gap-1">
                        {ops.map(b => (
                          <button key={b.kind} type="button" data-hub-op={b.kind} disabled={isBusy} title={OP_TITLE[b.kind]}
                            aria-expanded={b.note ? noteOpen?.kind === b.note : undefined}
                            onClick={() => {
                              const orderId = r.order?.id
                              if (!orderId) return
                              if (b.note) { setNoteOp(noteOpen?.kind === b.note ? null : { itemId: r.itemId, orderId, kind: b.note }); setNoteDraft(''); return }
                              void runOp(r, { kind: b.kind, orderId } as HubProcessOp)
                            }}
                            className={`btn h-7 px-2 text-[11px] ${b.kind === 'approve' ? 'btn-primary' : 'btn-ghost'}`}>{OP_LABEL[b.kind]}</button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1">
                      <span className="truncate text-ink-muted" title={r.prompt ?? undefined}>{r.prompt ? r.prompt.slice(0, 40) : ''}</span>
                      {canEditPrompt && (
                        <button type="button" data-hub-prompt-edit aria-label={`${r.code} 프롬프트 편집`} disabled={isBusy}
                          onClick={() => { setEditing(r.itemId); setDraft(r.prompt ?? '') }} className="text-ink-subtle hover:text-ink">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>,
                (editing === r.itemId || noteOpen || err || warn) ? (
                  <tr key={`${r.itemId}-x`} data-hub-row-extra={r.itemId}>
                    <td colSpan={10} className="pb-2 pl-8">
                      {editing === r.itemId && (
                        <div className="flex flex-col gap-1">
                          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} className="app-input w-full text-xs" placeholder="에이전트에게 덧붙일 지시문" />
                          <div className="flex gap-2">
                            <button type="button" data-hub-prompt-save disabled={isBusy} onClick={() => { void savePrompt(r) }} className="btn btn-primary h-7 px-2 text-xs">저장</button>
                            <button type="button" onClick={() => setEditing(null)} className="btn btn-ghost h-7 px-2 text-xs">취소</button>
                          </div>
                        </div>
                      )}
                      {noteOpen && (
                        <div data-hub-note={noteOpen.kind} className="flex flex-col gap-1">
                          <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={2} className="app-input w-full text-xs" placeholder={NOTE_PLACEHOLDER[noteOpen.kind]} />
                          <div className="flex gap-2">
                            <button type="button" data-hub-note-confirm disabled={isBusy || noteDraft.trim() === ''}
                              onClick={() => { void runOp(r, { kind: noteOpen.kind, orderId: noteOpen.orderId, note: noteDraft.trim() }) }}
                              className="btn btn-primary h-7 px-2 text-xs">{OP_LABEL[noteOpen.kind]} 확정</button>
                            <button type="button" onClick={() => { setNoteOp(null); setNoteDraft('') }} className="btn btn-ghost h-7 px-2 text-xs">취소</button>
                          </div>
                        </div>
                      )}
                      {err && <span data-hub-error className="block text-[11px] text-accent-warning">{err}</span>}
                      {warn && <span data-hub-warning className="block text-[11px] text-pending">{warn}</span>}
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
