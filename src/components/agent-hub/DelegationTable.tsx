'use client'
// 위임 표 — WBS 트리 순서로 항목을 나열하고 리프마다 위임 체크·단계·주문 상태·착수 대기 사유·에이전트·마지막 신호·조정.
// 부모 행 체크 = 하위 리프 일괄(관리자). 체크는 즉시 표시되고 잠기지 않는다. 1.5초 모아 applyHubDelegations 1건으로
// 보내고 응답의 허브로 표를 갱신한다(2026-09-14 체크 지연 개선 — 종전 체크 1개 = 액션 2건 직렬 + 0.8~1.0초 잠김).
// 조정(승인·반려·승인 취소·재작업 요청·중단)과 단계 직접 조정은 관리자 또는 서브트리 관리자
// (대상 리프의 strict 조상 중 담당자가 나, HubRow.canManage — 트랙 B, 2026-09-15), runHubProcessOp
// 1건으로 끝나고 응답의 허브로 교체한다(스펙 §11). 페이지 전체 refresh 금지(스펙 §7).
//
// 표 서식(2026-09-17 개편, 계획서 docs/superpowers/plans/2026-09-17-agent-hub-table-redesign.md):
// 열 10개를 7개 + 여유 열로 줄이고 table-layout: fixed + <colgroup> 으로 폭을 사용자가 끌어 바꾼다.
// 좌우 스크롤 상자에 높이를 줘 세로 sticky 머리글이 실제로 붙게 했고, 왼쪽 두세 열을 고정한다.
// 상태 변형(hover·열림 여부로 display 를 바꾸는) 유틸은 쓰지 않는다 — globals.css 끝의 반응형
// 안전망이 named layer 를 이겨 조용히 죽는다(CLAUDE.md). 조정 버튼은 상시 노출이다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { AgentHub, HubRow } from '@/lib/domain/agentHub'
import { ageLabel } from '@/lib/domain/seatmap'
import { stageLabelKo } from '@/lib/domain/stageLabels'
import { updateAgentPrompt } from '@/app/actions/wbsSpec'
import { applyHubDelegations, runHubProcessOp, type HubDelegationsResult, type HubProcessOp, type WbsStageCode } from '@/app/actions/agentHub'
import { PendingSaveChip } from '@/components/wbs/PendingSaveChip'
import { usePendingDelegations } from './usePendingDelegations'
import {
  DELEGATE_OFF_TITLE, DELEGATE_ON_TITLE, NEEDS_DELEGATION, NEEDS_DELEGATION_TONE, NO_ORDER, NOTE_PLACEHOLDER, OP_LABEL, OP_TITLE,
  REASON_TONE, STAGE_CODES, STAGE_NONE_LABEL, TOGGLE_DENIED_TITLE, hubStateLabel, hubStateTone, isHubApprovalWait,
} from './labels'
import s from './delegationTable.module.css'
import { stubBadgeText } from '@/lib/domain/forceProgress'

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
  /** 이름 클릭 → 그 WBS 항목의 상세 패널을 이 화면 위에 연다(AgentHubView 가 RowDetailPanel 을 띄운다). */
  onSelect?: (itemId: string) => void
}

type NoteKind = 'reject' | 'rework'
/**
 * 주문 상태별 조정 버튼(§11). note 가 있는 것은 사유 입력 줄을, confirm 인 것(중단 — 되돌리기 어렵다)은
 * 같은 자리에 확인 줄을 먼저 연다(브라우저 confirm() 금지).
 * who='admin' 은 관리자 또는 서브트리 관리자(승인·중단), 'review' 는 관리자·담당자 본인·서브트리
 * 관리자(반려·승인 취소·재작업 요청, 2026-09-14 "담당자 본인도 허용" + 2026-09-15 트랙 B). 서버 자격
 * (loadOrderForAdmin·loadOrderForReview·requireSubtreeManagerOrAdmin, runHubProcessOp)과 같은 경계다.
 * 리프 본인 담당자는 canManage 가 조상만 보므로 who='admin' 버튼(승인)에는 여전히 안 뜬다(분리 원칙).
 */
type OpButton = { kind: keyof typeof OP_LABEL; who: 'admin' | 'review'; note?: NoteKind; confirm?: true }
const OPS_BY_STATUS: Readonly<Record<string, readonly OpButton[]>> = {
  reported: [{ kind: 'approve', who: 'admin' }, { kind: 'reject', who: 'review', note: 'reject' }],
  approved: [{ kind: 'unapprove', who: 'review' }, { kind: 'rework', who: 'review', note: 'rework' }],
  claimed: [{ kind: 'stop', who: 'admin', confirm: true }],
}

/**
 * 열 정의 — 여기 순서가 곧 <colgroup> 과 셀 순서다. w 는 기본 폭, min 은 끌어서 줄일 수 있는 하한.
 * table-layout: fixed 는 내용이 열보다 길면 잘라내므로 하한을 열마다 따로 둔다.
 * 맨 끝 "여유" 열은 남는 폭을 먹는 자리라 손잡이를 두지 않는다.
 */
const COLS = [
  { key: 'check', label: '위임', w: 38, min: 32 },
  { key: 'code', label: '코드', w: 126, min: 80 },
  { key: 'name', label: '작업', w: 296, min: 140 },
  { key: 'owner', label: '담당자', w: 88, min: 60 },
  { key: 'state', label: '단계 · 상태', w: 182, min: 128 },
  { key: 'reason', label: '사유', w: 116, min: 72 },
  { key: 'agent', label: '에이전트 · 신호', w: 162, min: 92 },
  { key: 'ops', label: '조정', w: 176, min: 96 },
] as const
type ColKey = (typeof COLS)[number]['key']
const COL_W = Object.fromEntries(COLS.map(c => [c.key, c.w])) as Record<ColKey, number>
const COL_MIN = Object.fromEntries(COLS.map(c => [c.key, c.min])) as Record<ColKey, number>
/** 열 너비는 이 브라우저에만 남는다 — 읽기·쓰기 모두 try/catch(사생활 보호 창·차단된 사이트 데이터). */
const COL_W_KEY = 'dflow-hub-colw'
const VIEW_KEY = 'dflow-hub-view'

const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

/**
 * 부모 → 내가 켤 수 있는 자손 리프 id. 표 행이 전위 순서라 stack 없이 한 번에 만든다.
 * canToggle(리프·마일스톤 아님·관리자 또는 담당자 본인)로 미리 거른다 — 서버 가드
 * (requireDelegationRight)와 같은 규칙이라 묶음에 거부당할 항목이 실리지 않는다.
 * 관리자는 모든 리프가 canToggle 이라 종전과 같고, 멤버는 자기 담당 리프만 한 번에 켠다.
 */
function leafDescendants(rows: HubRow[]): Map<string, string[]> {
  const parentOf = new Map(rows.map(r => [r.itemId, r.parentId]))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.canToggle) continue
    let p = r.parentId
    while (p) { const l = out.get(p); if (l) l.push(r.itemId); else out.set(p, [r.itemId]); p = parentOf.get(p) ?? null }
  }
  return out
}

function ParentCheckbox({ state, count, onClick }: { state: 'all' | 'some' | 'none'; count: number; onClick: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some' }, [state])
  // 네이티브 체크박스를 그대로 쓴다 — indeterminate 3상태를 직접 그리지 않으려는 것이고,
  // 날것으로 보이던 원인은 형태가 아니라 파란 기본색이라 accent-color 만 바꾼다.
  return (
    <input ref={ref} type="checkbox" data-hub-parent-toggle checked={state === 'all'}
      aria-label={`하위 ${count}건 한 번에 위임`} title={`내가 켤 수 있는 하위 리프 ${count}건을 한 번에 위임/해제합니다.`}
      onChange={onClick} className="h-[15px] w-[15px] accent-brand" />
  )
}

export function DelegationTable({ rows, projectId, isAdmin, filter, onFilter, nowMs, onHub, onChanged, onSelect }: Props) {
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
  const [confirmOp, setConfirmOp] = useState<{ itemId: string; orderId: string; kind: 'stop' } | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  // 단계 select 의 낙관 표시 — 응답(성공·실패)이 오면 지운다. 실패면 서버값으로 돌아간다.
  const [stageOpt, setStageOpt] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  // 착수 대기 사유 전문을 펼친 행. 칩을 누르면 열린다.
  const [reasonOpen, setReasonOpen] = useState<string | null>(null)
  // 표 보기 — 열 너비, 고정 범위(1=위임·코드, 2=작업까지), 밀도.
  const [colW, setColW] = useState<Record<ColKey, number>>(COL_W)
  const [freeze, setFreeze] = useState<1 | 2>(1)
  const [dense, setDense] = useState(true)
  const [onlyWait, setOnlyWait] = useState(false)

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

  // 표시 행: mine 이면 내 담당 리프 + 내가 서브트리 관리자인 리프(트랙 B), 「승인 대기만」이면 승인 대기(reported) 리프,
  // 그리고 그 조상만. 접힌 부모의 자손은 숨긴다.
  const visible = useMemo(() => {
    let keep: Set<string> | null = null
    if (filter === 'mine' || onlyWait) {
      keep = new Set()
      for (const r of rows) {
        if (filter === 'mine' && !(r.isLeaf && (r.assigneeMine || r.canManage))) continue
        if (onlyWait && !isHubApprovalWait(r.order)) continue
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
  }, [rows, filter, onlyWait, folded, byId])

  const waitCount = useMemo(() => rows.filter(r => isHubApprovalWait(r.order)).length, [rows])

  const mapWith = <V,>(m: ReadonlyMap<string, V>, k: string, v: V | null) => { const n = new Map(m); if (v === null) n.delete(k); else n.set(k, v); return n }
  const setWith = (s2: ReadonlySet<string>, k: string, on: boolean) => { const n = new Set(s2); if (on) n.add(k); else n.delete(k); return n }

  // 폭의 동기 사본 — 상태 갱신은 다음 렌더에야 보이는데, 드래그의 pointermove·pointerup 과
  // 키 반복은 한 배치에 여러 번 들어온다. 매번 state 를 읽으면 그 배치의 첫 값만 반영된다.
  const wRef = useRef(colW)
  // ── 보기 설정 저장 — 이 브라우저 한정. 읽지 못해도 기본값으로 정상 동작해야 한다.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COL_W_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<ColKey, number>>
        const n = { ...COL_W }
        for (const c of COLS) { const v = saved[c.key]; if (typeof v === 'number' && Number.isFinite(v)) n[c.key] = Math.max(c.min, Math.round(v)) }
        wRef.current = n
        setColW(n)
      }
      const view = localStorage.getItem(VIEW_KEY)
      if (view) {
        const v = JSON.parse(view) as { freeze?: number; dense?: boolean }
        if (v.freeze === 2) setFreeze(2)
        if (typeof v.dense === 'boolean') setDense(v.dense)
      }
    } catch { /* 사생활 보호 창·차단된 사이트 데이터 — 기본값으로 간다 */ }
  }, [])

  const saveColW = (w: Record<ColKey, number>) => { try { localStorage.setItem(COL_W_KEY, JSON.stringify(w)) } catch {} }
  const saveView = (v: { freeze: 1 | 2; dense: boolean }) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)) } catch {} }

  const applyW = (next: Record<ColKey, number>, persist: boolean) => {
    wRef.current = next
    setColW(next)
    if (persist) saveColW(next)
  }
  const bump = (key: ColKey, px: number, persist: boolean) =>
    applyW({ ...wRef.current, [key]: Math.max(COL_MIN[key], Math.round(px)) }, persist)

  const drag = useRef<{ key: ColKey; x: number; w: number } | null>(null)

  const onHandleDown = (key: ColKey) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId) // 포인터 캡처가 없는 환경(jsdom)에서도 드래그는 된다
    drag.current = { key, x: e.clientX, w: wRef.current[key] }
  }
  const onHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    bump(d.key, d.w + e.clientX - d.x, false)
  }
  const onHandleUp = () => {
    if (!drag.current) return
    drag.current = null
    saveColW(wRef.current)
  }
  const onHandleKey = (key: ColKey) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 32 : 8
    const cur = wRef.current[key]
    const next = e.key === 'ArrowLeft' ? cur - step : e.key === 'ArrowRight' ? cur + step : e.key === 'Home' ? COL_W[key] : null
    if (next === null) return
    e.preventDefault()
    bump(key, next, true)
  }
  const resetOne = (key: ColKey) => bump(key, COL_W[key], true)
  const resetAll = () => applyW(COL_W, true)

  // 가로로 밀려 있는 동안에만 고정 구역 오른쪽에 경계 그림자 — 속성만 바꿔 다시 그리지 않는다.
  const boxRef = useRef<HTMLDivElement>(null)
  const onScroll = () => { const el = boxRef.current; if (el) el.dataset.shift = el.scrollLeft > 0 ? '1' : '0' }

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
    setBusy(s2 => setWith(s2, r.itemId, true)); setRowErr(m => mapWith(m, r.itemId, null))
    try {
      const res = await updateAgentPrompt(r.itemId, draft)
      if (!res.ok) { setRowErr(m => mapWith(m, r.itemId, res.error ?? '실패')); return }
      setEditing(null)
      await onChanged()
    } catch (e) {
      setRowErr(m => mapWith(m, r.itemId, e instanceof Error ? e.message : String(e)))
    } finally { setBusy(s2 => setWith(s2, r.itemId, false)) }
  }

  /** 조정 1건 — 요청 1건, 응답의 허브로 교체. 실패·경고는 그 행 아래에. */
  const runOp = async (r: HubRow, op: HubProcessOp) => {
    setBusy(s2 => setWith(s2, r.itemId, true)); setRowErr(m => mapWith(m, r.itemId, null)); setRowWarn(m => mapWith(m, r.itemId, null))
    try {
      const res = await runHubProcessOp(projectId, op)
      if (!res.ok) { setRowErr(m => mapWith(m, r.itemId, res.error)); return }
      if (res.warning) setRowWarn(m => mapWith(m, r.itemId, res.warning ?? null))
      if (noteOp?.itemId === r.itemId) { setNoteOp(null); setNoteDraft('') }
      if (confirmOp?.itemId === r.itemId) setConfirmOp(null)
      if (res.hub) onHub(res.hub)
      else { setNotice(res.hubError ?? null); await onChanged() }
    } catch (e) {
      setRowErr(m => mapWith(m, r.itemId, e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(s2 => setWith(s2, r.itemId, false))
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
  const tool = (on: boolean, label: string, title: string, onClick: () => void, extra?: Record<string, string>) => (
    <button type="button" aria-pressed={on} title={title} onClick={onClick} {...extra}
      className={`rounded-md border px-2 py-1 text-[11px] ${on ? 'border-brand-ring bg-brand-weak text-brand' : 'border-line text-ink-muted hover:bg-surface-2'}`}>{label}</button>
  )

  // 고정 열 판정 — 마지막 고정 열에만 경계 그림자를 붙인다.
  const lastFrozen: ColKey = freeze === 2 ? 'name' : 'code'
  const colCls = (key: ColKey) => {
    const frozen = key === 'check' || key === 'code' || (freeze === 2 && key === 'name')
    return cls(
      frozen && s.freeze,
      key === 'check' && s.cCheck, key === 'code' && s.cCode, key === 'name' && s.cName,
      frozen && key === lastFrozen && s.edge,
    )
  }
  const totalW = COLS.reduce((a, c) => a + colW[c.key], 0)
  // 좌측 고정 열의 left 오프셋 — 폭이 바뀔 때마다 여기서 다시 계산한다.
  const boxVars = { '--l-code': `${colW.check}px`, '--l-name': `${colW.check + colW.code}px` } as React.CSSProperties
  let leafSeq = 0

  return (
    <section aria-label="위임 표" className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="표시 범위">{seg('mine', '내 담당')}{seg('all', '전체')}</div>
          {tool(onlyWait, `승인 대기만${waitCount ? ` ${waitCount}` : ''}`, '완료 보고가 올라와 승인을 기다리는 행만 봅니다', () => setOnlyWait(v => !v), { 'data-hub-only-wait': '' })}
          {(pend.isPending || pend.saving) && (
            <span data-hub-pending className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
              <span data-hub-pending-count>{pend.count}건</span>
              <PendingSaveChip isPending={pend.isPending} saving={pend.saving} remainingMs={pend.remainingMs} onSaveNow={() => { void pend.flush() }} />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tool(dense, '조밀', '행 높이를 줄입니다', () => { const v = !dense; setDense(v); saveView({ freeze, dense: v }) })}
          {tool(freeze === 2, '작업 열까지 고정', '가로로 밀어도 위임·코드·작업 열이 왼쪽에 남습니다', () => { const v = freeze === 2 ? 1 : 2; setFreeze(v); saveView({ freeze: v, dense }) })}
          {tool(false, '열 너비 초기화', '모든 열을 기본 폭으로 되돌립니다', resetAll)}
        </div>
      </div>
      <p className="mb-2 text-[11px] text-ink-subtle">리프 항목의 체크가 위임(발행)입니다. 부모 체크는 내가 켤 수 있는 하위 리프를 한 번에 켭니다. 머리글 경계를 끌면 열 너비가 바뀝니다.</p>
      {notice && <p data-hub-notice role="status" className="mb-2 rounded-md bg-pending-weak px-2 py-1 text-xs text-pending">{notice}</p>}
      <div ref={boxRef} data-shift="0" onScroll={onScroll} style={boxVars} className={s.box}>
        <table className={cls(s.table, dense && s.dense)} style={{ minWidth: `${totalW}px` }}>
          <colgroup>
            {COLS.map(c => <col key={c.key} data-col={c.key} style={{ width: `${colW[c.key]}px` }} />)}
            <col data-col="slack" />
          </colgroup>
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key} scope="col" className={colCls(c.key)}>
                  {c.label}
                  <button type="button" data-rsz={c.key} className={s.rsz} aria-label={`${c.label} 열 너비`}
                    title="끌어서 너비 조절 · 두 번 누르면 기본값 · ←/→ 로도 조절"
                    onPointerDown={onHandleDown(c.key)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                    onDoubleClick={() => resetOne(c.key)} onKeyDown={onHandleKey(c.key)} />
                </th>
              ))}
              <th scope="col"><span className="sr-only">여유</span></th>
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
              // 단계 select 는 관리자 또는 서브트리 관리자. 조정 버튼은 관리자 + 담당자 본인 + 서브트리
              // 관리자가 볼 수 있고, 버튼별 who 로 다시 거른다(트랙 B, 2026-09-15).
              // 단계는 개발 워크플로 리프의 것이다(스펙 §3.5) — dev_workflow 가 꺼진 행에는 select 를 두지 않는다.
              const canStage = (isAdmin || r.canManage) && r.isLeaf && !r.milestone && r.devWorkflow
              const canReviewRow = (isAdmin || r.assigneeMine || r.canManage) && r.isLeaf && !r.milestone
              const ops = canReviewRow && r.order
                ? (OPS_BY_STATUS[r.order.status] ?? []).filter(b => b.who === 'admin' ? (isAdmin || r.canManage) : (isAdmin || r.assigneeMine || r.canManage))
                : []
              // 스텁 잔존(강제 진행 스펙 F6·F13) — 승인은 잠그고 이름 옆에 배지·링크를 둔다.
              const stubs = r.stubPending ?? []
              const noteOpen = noteOp?.itemId === r.itemId ? noteOp : null
              const confirmOpen = confirmOp?.itemId === r.itemId ? confirmOp : null
              const showReason = reasonOpen === r.itemId && r.waitReason !== null
              const zebra = r.isLeaf && leafSeq++ % 2 === 1
              return [
                <tr key={r.itemId} data-hub-row={r.itemId}
                  className={cls(s.row, !r.isLeaf && s.band, zebra && s.zebra, isHubApprovalWait(r.order) && s.mark)}>
                  <td className={colCls('check')}>
                    {r.isLeaf
                      ? <input type="checkbox" data-hub-toggle checked={checked} disabled={!r.canToggle}
                          title={!r.canToggle ? TOGGLE_DENIED_TITLE : checked ? DELEGATE_OFF_TITLE : DELEGATE_ON_TITLE} aria-label={`${r.code} 위임`}
                          onChange={() => toggleLeaf(r)} className="h-[15px] w-[15px] accent-brand" />
                      : (leaves.get(r.itemId)?.length ?? 0) > 0
                        ? <ParentCheckbox count={leaves.get(r.itemId)!.length} state={parentState(r)} onClick={() => toggleParent(r)} />
                        : null}
                  </td>
                  <td className={cls(colCls('code'), 'font-mono text-[11px] text-ink-muted')}>
                    <span className={s.trunc} title={r.code}>{r.code}</span>
                  </td>
                  <td className={colCls('name')}>
                    <span data-hub-name style={{ paddingLeft: `${r.depth * 16}px` }} className="flex min-w-0 items-center gap-1">
                      {!r.isLeaf && (
                        <button type="button" data-hub-fold aria-expanded={!folded.has(r.itemId)} aria-label={`${r.code} 접기/펼치기`}
                          onClick={() => setFolded(s2 => setWith(s2, r.itemId, !s2.has(r.itemId)))} className="shrink-0 text-ink-subtle hover:text-ink">
                          {folded.has(r.itemId) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {onSelect
                        ? <button type="button" data-hub-open={r.itemId} onClick={() => onSelect(r.itemId)}
                            title={r.name} className={cls(s.trunc, 'min-w-0 text-left hover:underline', r.isLeaf ? 'text-ink' : 'font-semibold text-ink')}>{r.name}</button>
                        : <span className={cls(s.trunc, 'min-w-0', r.isLeaf ? 'text-ink' : 'font-semibold text-ink')} title={r.name}>{r.name}</span>}
                      {stubs.length > 0 && (
                        <a data-hub-stub-badge href={`/p/${projectId}/wbs?focus=${stubs[0].subTaskId}&open=1`} title={stubs.map(x => x.label).join('\n')}
                          className="shrink-0 rounded-full border border-delayed/40 bg-delayed-weak px-1.5 py-0.5 text-[10px] font-bold text-delayed">
                          {stubBadgeText(stubs.length)}
                        </a>
                      )}
                      {canEditPrompt && (
                        <button type="button" data-hub-prompt-edit aria-label={`${r.code} 프롬프트 편집`} disabled={isBusy}
                          onClick={() => { setEditing(r.itemId); setDraft(r.prompt ?? '') }}
                          title={r.prompt ? `에이전트 지시문: ${r.prompt}` : '에이전트에게 덧붙일 지시문을 씁니다'}
                          className={cls('shrink-0 hover:text-ink', r.prompt ? 'text-brand' : 'text-ink-subtle')}>
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className={cls(colCls('owner'), 'text-ink-muted')}>
                    <span className={s.trunc} title={r.canManage && !r.assigneeMine ? `${r.assigneeName ?? ''} — 상위 항목 담당자로서 조정할 수 있는 항목입니다(서브트리 관리)` : r.assigneeName ?? undefined}>{r.assigneeName ?? ''}</span>
                  </td>
                  <td className={cls(colCls('state'), s.clip)}>
                    <span className="flex flex-nowrap items-center gap-1">
                      {canStage
                        ? <select data-hub-stage value={stageShown ?? ''} disabled={isBusy || r.stageLocked} aria-label={`${r.code} 단계`}
                            title={r.stageLocked
                              ? '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.'
                              : '단계 직접 조정 — 실적은 그 단계의 크레딧으로 지정됩니다'}
                            onChange={e => changeStage(r, e.target.value)} className="app-input h-6 min-w-0 shrink py-0 text-[11px]">
                            <option value="">{STAGE_NONE_LABEL}</option>
                            {STAGE_CODES.map(c => <option key={c} value={c}>{stageLabelKo(c)}</option>)}
                          </select>
                        : r.isLeaf && !r.milestone
                          ? <span data-hub-stage-text className="shrink-0 text-[11px] text-ink-muted">{stageLabelKo(r.stage)}</span>
                          : null}
                      {r.order
                        ? <span className={`chip shrink-0 ${hubStateTone(r.order)}`}>{hubStateLabel(r.order)}</span>
                        : <span className="shrink-0 text-ink-subtle">{NO_ORDER}</span>}
                    </span>
                  </td>
                  <td className={cls(colCls('reason'), s.clip)}>
                    {r.isLeaf && r.devWorkflow && !r.delegated && <span className={`chip ${NEEDS_DELEGATION_TONE}`}>{NEEDS_DELEGATION}</span>}
                    {r.waitReason && (
                      <button type="button" data-hub-depends data-wait-reason={r.waitReason.kind}
                        aria-expanded={showReason} title={r.waitReason.text}
                        onClick={() => setReasonOpen(v => v === r.itemId ? null : r.itemId)}
                        className={`chip whitespace-nowrap ${REASON_TONE[r.waitReason.kind]}`}>{r.waitReason.label}</button>
                    )}
                  </td>
                  <td className={cls(colCls('agent'), s.clip)}>
                    <span className={cls(s.trunc, 'font-mono text-[11px] text-ink-muted')} title={r.order?.agent ?? undefined}>{r.order?.agent ?? ''}</span>
                    <span className="block text-[10px] tabular-nums text-ink-subtle">{sig}</span>
                  </td>
                  <td className={cls(colCls('ops'), s.clip)}>
                    {ops.length > 0 && (
                      <span className="flex flex-nowrap gap-1">
                        {ops.map(b => (
                          <button key={b.kind} type="button" data-hub-op={b.kind}
                            disabled={isBusy || (b.kind === 'approve' && stubs.length > 0)}
                            title={b.kind === 'approve' && stubs.length > 0 ? stubs.map(x => x.label).join('\n') : OP_TITLE[b.kind]}
                            aria-expanded={b.note ? noteOpen?.kind === b.note : b.confirm ? confirmOpen?.kind === b.kind : undefined}
                            onClick={() => {
                              const orderId = r.order?.id
                              if (!orderId) return
                              if (b.confirm && b.kind === 'stop') { setConfirmOp(confirmOpen ? null : { itemId: r.itemId, orderId, kind: b.kind }); setNoteOp(null); return }
                              if (b.note) { setNoteOp(noteOpen?.kind === b.note ? null : { itemId: r.itemId, orderId, kind: b.note }); setNoteDraft(''); setConfirmOp(null); return }
                              void runOp(r, { kind: b.kind, orderId } as HubProcessOp)
                            }}
                            className={`btn h-6 shrink-0 whitespace-nowrap px-2 text-[11px] ${b.kind === 'approve' ? 'btn-primary' : 'btn-ghost'}`}>{OP_LABEL[b.kind]}</button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td />
                </tr>,
                (editing === r.itemId || noteOpen || confirmOpen || showReason || err || warn) ? (
                  <tr key={`${r.itemId}-x`} data-hub-row-extra={r.itemId} className={s.extra}>
                    <td colSpan={9} className="pb-2 pl-8">
                      {showReason && r.waitReason && (
                        <p data-hub-reason-text className="mb-1 text-[11px] leading-relaxed text-ink-muted">{r.waitReason.text}</p>
                      )}
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
                      {confirmOpen && (
                        <div data-hub-confirm={confirmOpen.kind} className="flex flex-col gap-1">
                          <p className="text-[11px] leading-relaxed text-ink-muted">{OP_LABEL[confirmOpen.kind]}할까요? {OP_TITLE[confirmOpen.kind]}</p>
                          <div className="flex gap-2">
                            <button type="button" data-hub-confirm-go disabled={isBusy}
                              onClick={() => { void runOp(r, { kind: confirmOpen.kind, orderId: confirmOpen.orderId }) }}
                              className="btn btn-primary h-7 px-2 text-xs">{OP_LABEL[confirmOpen.kind]} 확정</button>
                            <button type="button" data-hub-confirm-cancel onClick={() => setConfirmOp(null)} className="btn btn-ghost h-7 px-2 text-xs">취소</button>
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
