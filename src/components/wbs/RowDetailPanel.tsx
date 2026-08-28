'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { X, FileText, Pencil, Plus, ChevronUp, ChevronDown, ChevronRight, Trash2, Paperclip, Upload, GitBranchPlus, GitBranch } from 'lucide-react'
import type { ComputedItem, DeliverableAttachment, DependencyType, OwnerKind, ProjectMember, TaskDependency, TeamCode } from '@/lib/domain/types'
import type { TaskSchedule } from '@/lib/domain/dependencySchedule'
import { evaluateStartReadiness, type PredecessorState } from '@/lib/domain/dependencyReadiness'
import {
  getChangeLogs, updateWbsFields, updateDeliverable, addWbsItem, addSubAct, deleteWbsItem, moveWbsItem,
  addTaskDependency, removeTaskDependency, type ChangeLogEntry,
} from '@/app/actions/wbs'
import { availableSubActTeams, willDiscardActual } from '@/lib/domain/subact'
import { canAddChild, canSplit } from '@/lib/domain/wbsAffordance'
import { listAttachments, recordAttachment, removeAttachment } from '@/app/actions/attachments'
import { createBrowserClient } from '@/lib/supabase/client'
import { formatWeightPct, formatPct1, fmtSize } from '@/lib/domain/format'
import { DependencyEgoGraph, type EgoNode } from './DependencyEgoGraph'
import { DEFAULT_LEVEL_LABELS, LevelBadge, OwnerBadges, STATUS, StatusChip, fmtDate, teamStyle } from './shared'
import { WbsAssigneeStagePanel } from './WbsAssigneeStagePanel'
import { ChangeHistoryList } from './ChangeHistoryList'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import type { DictKey } from '@/lib/i18n/dict'
const EMPTY_MEMBERS: ProjectMember[] = []
// 매 렌더 새 리터럴이면 readiness useMemo 가 매번 다시 돈다 — 모듈 상수로 고정.
const EMPTY_REFS: string[] = []

/** WBS 행 상세 패널 — 읽기(개요/담당/일정/진척/산출물 + 변경 이력)
 *  + PMO 편집(이름·일정·산출물 수정, 하위 추가, 순서 이동, 삭제). */
export function RowDetailPanel({
  item, allItems = [], dependencies = [], schedule, onClose, editable = false, canAttach = false,
  canEditDeliverable = false, projectId, levelLabels = DEFAULT_LEVEL_LABELS, maxDepth = null,
  members = EMPTY_MEMBERS, onSelectItem, unresolvedRefs = EMPTY_REFS,
}: {
  item: ComputedItem
  allItems?: ComputedItem[]
  dependencies?: TaskDependency[]
  schedule?: TaskSchedule
  onClose: () => void
  editable?: boolean
  canAttach?: boolean
  /** 산출물 텍스트 인라인 편집 권한 — PMO 또는 담당팀(첨부와 동일). editable(PMO 전체 폼)과 별개. */
  canEditDeliverable?: boolean
  projectId: string
  /** 프로젝트별 depth 라벨(§7.3 ProjectConfig) — 상위(WbsGanttSheet)가 서버 페이지에서 받아 전파. */
  levelLabels?: string[]
  /** 프로젝트별 최대 깊이(§7.3 ProjectConfig, null=무제한) — 자식 추가 어포던스 판정(canAddChild)에 사용. */
  maxDepth?: number | null
  /** 프로젝트 로스터 — 담당·단계 섹션(WbsAssigneeStagePanel)의 담당자 셀렉트 데이터 소스(§2.5). */
  members?: ProjectMember[]
  /** 선행·후속 항목 클릭 시 그 작업으로 상세를 갈아끼운다. 미제공이면 항목은 클릭 불가 텍스트로 남는다. */
  onSelectItem?: (id: string) => void
  /**
   * 이 작업의 depends 중 프로젝트에서 해석되지 않은 external_ref.
   * claim 게이트는 이것을 미충족으로 보고 409 를 내므로 목록에서 빼면 화면이 위장한다.
   */
  unresolvedRefs?: string[]
}) {
  const router = useRouter()
  const { t } = useLocale()
  const allTeamCodes = useTeamCodes()
  const [logs, setLogs] = useState<ChangeLogEntry[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [addName, setAddName] = useState<string | null>(null) // null=닫힘
  const [subOpen, setSubOpen] = useState(false)               // SUB-ACT 추가 폼 열림
  const [subTeam, setSubTeam] = useState<TeamCode | null>(null)
  const [subKind, setSubKind] = useState<OwnerKind>('primary')
  const [delivEditing, setDelivEditing] = useState(false)   // 산출물 인라인 편집(전체 폼과 별개)
  const [delivDraft, setDelivDraft] = useState('')
  const [delivBusy, setDelivBusy] = useState(false)
  const [delivErr, setDelivErr] = useState<string | null>(null)
  const [dependencyOpen, setDependencyOpen] = useState(false)
  // 기본은 목록 — 그래프는 전체를 한눈에 보고 싶을 때 켠다. 세션 상태로만 둔다(저장 안 함).
  const [depView, setDepView] = useState<'list' | 'graph'>('list')
  // 명세 챕터와 같은 접기. 기본은 펼침 — 접힘이 기본이면 시작 가능 배너까지 한 번 더 눌러야 보인다.
  const [depBodyOpen, setDepBodyOpen] = useState(true)
  const [predecessorId, setPredecessorId] = useState('')
  const [dependencyType, setDependencyType] = useState<DependencyType>('FS')
  const [lagDays, setLagDays] = useState('0')
  const [dependencyBusy, setDependencyBusy] = useState(false)
  const [dependencyErr, setDependencyErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: item.name, start: item.plannedStart ?? '', end: item.plannedEnd ?? '', deliverable: item.deliverable ?? '',
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setLogs(null)
    setEditing(false); setConfirmDel(false); setAddName(null); setErr(null)
    setSubOpen(false); setSubTeam(null); setSubKind('primary')
    setDelivEditing(false); setDelivErr(null)
    setDependencyOpen(false); setPredecessorId(''); setDependencyType('FS'); setLagDays('0'); setDependencyErr(null)
    setForm({ name: item.name, start: item.plannedStart ?? '', end: item.plannedEnd ?? '', deliverable: item.deliverable ?? '' })
    getChangeLogs(item.id).then(r => { if (alive) setLogs(r) }).catch(() => { if (alive) setLogs([]) })
    return () => { alive = false }
  }, [item.id, item.name, item.plannedStart, item.plannedEnd, item.deliverable])

  const canChild = canAddChild(item.depth, maxDepth)
  // SUB-ACT 추가는 스스로 SUB-ACT 가 아니고, 자식이 없거나 자식 전원이 이미 SUB-ACT 일 때만
  // (addSubAct 서버 가드 ①②와 동치 — 기존 SUB-ACT 형제에 팀을 추가하는 경로는 리프가 아니어도 허용).
  const isAct = canSplit(item.isOwnerSplit, item.children.some(c => !c.isOwnerSplit))
  const subTeams = useMemo(() => availableSubActTeams(item.children, allTeamCodes), [item.children, allTeamCodes])
  const flipWarn = willDiscardActual(item.children.length, item.actualPct)
  const itemById = useMemo(() => new Map(allItems.map(candidate => [candidate.id, candidate])), [allItems])
  const incomingDependencies = useMemo(
    () => dependencies.filter(dep => dep.successorId === item.id),
    [dependencies, item.id],
  )
  const outgoingDependencies = useMemo(
    () => dependencies.filter(dep => dep.predecessorId === item.id),
    [dependencies, item.id],
  )
  // 선행 충족 판정 — 이 작업을 지금 시작할 수 있는지와, 선행 각 건의 충족 여부.
  const readiness = useMemo(
    () => evaluateStartReadiness(
      { id: item.id, rolledActualPct: item.rolledActualPct, stage: item.stage ?? null },
      incomingDependencies,
      itemById,
      unresolvedRefs,
    ),
    [item.id, item.rolledActualPct, item.stage, incomingDependencies, itemById, unresolvedRefs],
  )
  const relationBadge = (dep: TaskDependency) => `${dep.type}${dep.lagDays > 0 ? ` +${dep.lagDays}` : ''}`
  const egoPredecessors = useMemo<EgoNode[]>(() => [
    ...incomingDependencies.map(dep => ({
      key: dep.id,
      item: itemById.get(dep.predecessorId) ?? null,
      state: readiness.byDependencyId.get(dep.id) ?? 'unknown',
      imported: dep.origin === 'spec',
      badge: relationBadge(dep),
    })),
    // 목록 뷰와 같은 재료를 쓴다 — 그래프에서 빠지면 그 뷰에서만 위장이 되살아난다.
    ...unresolvedRefs.map(ref => ({
      key: `unresolved:${ref}`,
      item: null,
      fallbackLabel: lastRefSegment(ref),
      state: 'unknown' as const,
      imported: true,
      badge: 'FS',
    })),
  ], [incomingDependencies, itemById, readiness, unresolvedRefs])
  const egoSuccessors = useMemo<EgoNode[]>(() => outgoingDependencies.map(dep => ({
    key: dep.id,
    item: itemById.get(dep.successorId) ?? null,
    state: null,
    imported: dep.origin === 'spec',
    badge: relationBadge(dep),
  })), [outgoingDependencies, itemById])
  const predecessorCandidates = useMemo(() => {
    // 이미 연결된 선행은 후보에서 뺀다 — 단 **실제 행(manual)만** 센다.
    // wbs.md 에서 합성된 선행까지 빼면 그 쌍에 FS/SS·lag 를 얹을 길이 사라진다(병합 전에는 되던 일).
    // 실제 행을 얹으면 병합 규칙상 그쪽이 이기므로 합성 행과 겹쳐 그려지지도 않는다.
    const existing = new Set(
      incomingDependencies.filter(dep => dep.origin === 'manual').map(dep => dep.predecessorId),
    )
    const nextById = new Map<string, string[]>()
    dependencies.forEach(dep => nextById.set(dep.predecessorId, [...(nextById.get(dep.predecessorId) ?? []), dep.successorId]))
    const wouldCycle = (candidateId: string) => {
      const seen = new Set<string>()
      const stack = [item.id]
      while (stack.length) {
        const id = stack.pop()!
        if (id === candidateId) return true
        if (seen.has(id)) continue
        seen.add(id)
        stack.push(...(nextById.get(id) ?? []))
      }
      return false
    }
    return allItems.filter(candidate =>
      candidate.id !== item.id && candidate.plannedStart && candidate.plannedEnd &&
      !existing.has(candidate.id) && !wouldCycle(candidate.id),
    )
  }, [allItems, dependencies, incomingDependencies, item.id])
  // 남은 팀이 하나뿐이면(유추가 아니라 유일 선택지) 폼을 열 때 자동 선택 — 클릭 한 번 절약.
  useEffect(() => {
    if (subOpen && !subTeam && subTeams.length === 1) setSubTeam(subTeams[0])
  }, [subOpen, subTeam, subTeams])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true); setErr(null)
    const res = await fn()
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? t('wbs.errGeneric')); return }
    after?.()
    router.refresh()
  }

  const saveFields = () =>
    run(() => updateWbsFields(item.id, {
      name: form.name,
      plannedStart: form.start || null,
      plannedEnd: form.end || null,
      deliverable: form.deliverable || null,
    }), () => setEditing(false))

  const openDeliv = () => { setDelivDraft(item.deliverable ?? ''); setDelivErr(null); setDelivEditing(true) }
  async function saveDeliv() {
    setDelivBusy(true); setDelivErr(null)
    const res = await updateDeliverable(item.id, delivDraft.trim() || null)
    setDelivBusy(false)
    if (!res.ok) { setDelivErr(res.error ?? t('wbs.errGeneric')); return }
    setDelivEditing(false)
    router.refresh()
  }

  const addChild = () => {
    if (!canChild || !addName?.trim()) return
    run(() => addWbsItem(projectId, item.id, addName.trim()), () => setAddName(null))
  }
  const addSub = () => {
    if (!subTeam) return
    run(() => addSubAct(item.id, subTeam, subKind), () => { setSubOpen(false); setSubTeam(null); setSubKind('primary') })
  }
  const doDelete = () => run(() => deleteWbsItem(item.id), () => onClose())

  async function addDependency() {
    const lag = Number(lagDays)
    if (!predecessorId || !Number.isInteger(lag) || lag < 0 || lag > 365) {
      setDependencyErr(t('wbs.dependencyInputError'))
      return
    }
    setDependencyBusy(true); setDependencyErr(null)
    const result = await addTaskDependency(projectId, predecessorId, item.id, dependencyType, lag)
    setDependencyBusy(false)
    if (!result.ok) { setDependencyErr(result.error ?? t('wbs.errGeneric')); return }
    setDependencyOpen(false); setPredecessorId(''); setLagDays('0')
    router.refresh()
  }

  async function removeDependency(id: string) {
    setDependencyBusy(true); setDependencyErr(null)
    const result = await removeTaskDependency(id)
    setDependencyBusy(false)
    if (!result.ok) { setDependencyErr(result.error ?? t('wbs.errGeneric')); return }
    router.refresh()
  }

  // ── 패널 폭 드래그 조절 — 명세·의존 목록이 길어 고정 448px(max-w-md)로는 좁다(2026-08-20). ──
  // 초기 렌더는 SSR 과 동일한 기본값으로 그리고, 저장값은 마운트 후 적용(하이드레이션 파리티).
  const DEFAULT_PANEL_WIDTH = 448
  const MIN_PANEL_WIDTH = 360
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const panelWidthRef = useRef(DEFAULT_PANEL_WIDTH)
  useEffect(() => {
    // localStorage 는 프라이빗 모드·일부 테스트 환경에서 없거나 던진다 — 실패는 기본 폭 유지.
    let saved = NaN
    try { saved = Number(window.localStorage?.getItem('wbs.detailPanelWidth')) } catch { /* 기본 폭 */ }
    if (Number.isFinite(saved) && saved >= MIN_PANEL_WIDTH) {
      const w = Math.min(saved, 1400)
      panelWidthRef.current = w
      setPanelWidth(w)
    }
  }, [])
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none' // 드래그 중 본문 텍스트 선택 방지
    const maxW = Math.min(window.innerWidth - 64, 1400)
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, MIN_PANEL_WIDTH), maxW))
      panelWidthRef.current = w
      setPanelWidth(w)
    }
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      try { window.localStorage?.setItem('wbs.detailPanelWidth', String(panelWidthRef.current)) } catch { /* 저장 실패는 무시 */ }
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }
  function resetWidth() {
    panelWidthRef.current = DEFAULT_PANEL_WIDTH
    setPanelWidth(DEFAULT_PANEL_WIDTH)
    try { window.localStorage?.removeItem('wbs.detailPanelWidth') } catch { /* 무시 */ }
  }

  return (
    <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label={`${item.name} ${t('wbs.detailSuffix')}`}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside
        style={{ width: `min(${panelWidth}px, 100vw)` }}
        className="absolute right-0 top-0 flex h-full flex-col bg-surface shadow-[var(--shadow-xl)] animate-[slidein_.18s_ease-out]"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('wbs.detailResize')}
          title={t('wbs.detailResize')}
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-brand/40 active:bg-brand/60"
        />
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LevelBadge depth={item.depth} isOwnerSplit={item.isOwnerSplit} levelLabels={levelLabels} />
              {item.code && <span className="text-[11px] font-semibold tabular-nums text-ink-subtle">{item.code}</span>}
            </div>
            <h2 className="mt-1.5 break-words text-[16px] font-bold leading-snug text-ink">{item.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editable && !editing && (
              <button onClick={() => setEditing(true)} aria-label={t('common.edit')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink"><Pencil className="h-4 w-4" /></button>
            )}
            <button onClick={onClose} aria-label={t('common.close')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {editing ? (
            <section className="space-y-3">
              <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.fieldName')}</span>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="app-input" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.colPlannedStart')}</span>
                  <input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} className="app-input px-2 text-xs" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.colPlannedEnd')}</span>
                  <input type="date" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className="app-input px-2 text-xs" /></label>
              </div>
              <label className="block"><span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.colDeliverable')}</span>
                <input value={form.deliverable} onChange={e => setForm(f => ({ ...f, deliverable: e.target.value }))} className="app-input" placeholder={t('wbs.deliverablePlaceholder')} /></label>
              {err && <p className="text-xs font-medium text-delayed">{err}</p>}
              <div className="flex gap-2">
                <button onClick={saveFields} disabled={busy} className="btn btn-primary flex-1">{busy ? t('wbs.saving') : t('common.save')}</button>
                <button onClick={() => { setEditing(false); setErr(null) }} className="btn btn-ghost">{t('common.cancel')}</button>
              </div>
            </section>
          ) : (
            <>
              <section className="grid grid-cols-3 gap-2">
                <Stat label={t('wbs.colPlannedPct')} value={`${formatPct1(item.plannedPct)}%`} />
                <Stat label={t('wbs.colActualPct')} value={`${formatPct1(item.rolledActualPct)}%`} />
                <Stat label={t('wbs.colAchievement')} value={item.achievement == null ? '—' : `${item.achievement}%`} />
              </section>
              {/* 개요 표(2026-08-28) — 아이콘 카드 4행이 세로로 44px 씩 먹던 것을 라벨·값 2열로.
                  상태도 같은 표에 넣는다: 라벨·값 쌍이라 성격이 같고, 떠 있던 한 줄이 사라진다. */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-line/50 py-2.5">
                <DlRow label={t('wbs.colStatus')}>
                  <span className={`chip ${STATUS[item.status].chip}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS[item.status].dot}`} />
                    {t(`status.${item.status}` as DictKey)}
                  </span>
                </DlRow>
                <DlRow label={t('wbs.colOwners')}>
                  {item.owners.length ? <OwnerBadges owners={item.owners} /> : <span className="text-ink-subtle">{t('wbs.unassigned')}</span>}
                </DlRow>
                <DlRow label={t('wbs.plannedSchedule')}>
                  <span className="tabular-nums">{fmtDate(item.plannedStart)} ~ {fmtDate(item.plannedEnd)}</span>
                </DlRow>
                <DlRow label={t('wbs.colWeight')}>
                  <span className="tabular-nums">{item.weight == null ? t('wbs.weightEqualSiblings') : formatWeightPct(item.weight)}</span>
                </DlRow>
                <DlRow label={t('wbs.colDeliverable')} span>
                  {delivEditing ? (
                    <div className="space-y-2 py-0.5">
                      <input autoFocus value={delivDraft} onChange={e => setDelivDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveDeliv(); if (e.key === 'Escape') { setDelivEditing(false); setDelivErr(null) } }}
                        className="app-input" placeholder={t('wbs.deliverablePlaceholder')} />
                      {delivErr && <p className="text-xs font-medium text-delayed">{delivErr}</p>}
                      <div className="flex gap-2">
                        <button onClick={saveDeliv} disabled={delivBusy} className="btn btn-primary h-8 px-3 text-xs">{delivBusy ? t('wbs.saving') : t('common.save')}</button>
                        <button onClick={() => { setDelivEditing(false); setDelivErr(null) }} className="btn btn-ghost h-8 px-3 text-xs">{t('common.cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      {item.deliverable ? <span className="min-w-0 break-words">{item.deliverable}</span> : <span className="text-ink-subtle">{t('common.none')}</span>}
                      {canEditDeliverable && (
                        <button onClick={openDeliv} aria-label={t('common.edit')} className="shrink-0 text-ink-subtle transition hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  )}
                </DlRow>
              </dl>
            </>
          )}

          {/* 담당(로스터 축)·단계(§2.5) — 팀 단위 owners(위 Field)와 별개인 개인 배정.
              별도 오버레이가 아니라 이 패널의 섹션으로 둔다(리뷰 라운드 1 — 두 번째
              fixed dialog는 aria-modal 뒤에서 키보드·스크린리더로 도달 불가했다). */}
          {!editing && (
            <WbsAssigneeStagePanel itemId={item.id} members={members} editable={editable} hasChildren={item.children.length > 0} />
          )}

          {!editing && (
            <section className="rounded-xl border border-line bg-surface-2/40 p-3" aria-label={t('wbs.dependencies')}>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setDepBodyOpen(open => !open)}
                  aria-expanded={depBodyOpen}
                  className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle transition hover:text-ink"
                >
                  {depBodyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <GitBranch className="h-3.5 w-3.5" /> {t('wbs.dependencies')}
                </button>
                {depBodyOpen && (
                <div className="flex items-center gap-1.5">
                  {schedule?.critical && (
                    <span className="rounded-full border border-delayed/35 bg-delayed-weak px-2 py-0.5 text-[10px] font-bold text-delayed">
                      {t('wbs.criticalPath')}
                    </span>
                  )}
                  <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label={t('wbs.dependencies')}>
                    {(['list', 'graph'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setDepView(mode)}
                        aria-pressed={depView === mode}
                        className={`h-7 px-2 text-[11px] transition ${
                          depView === mode ? 'bg-brand-weak font-semibold text-brand' : 'text-ink-muted hover:text-ink'
                        }`}
                      >
                        {t(mode === 'list' ? 'wbs.depViewList' : 'wbs.depViewGraph')}
                      </button>
                    ))}
                  </div>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => { setDependencyOpen(open => !open); setDependencyErr(null) }}
                      className="btn btn-ghost h-7 px-2 text-[11px]"
                      aria-expanded={dependencyOpen}
                    >
                      <Plus className="h-3 w-3" /> {t('wbs.addPredecessor')}
                    </button>
                  )}
                </div>
                )}
              </div>

              {depBodyOpen && (
              <>
              {schedule && (schedule.forecastStart !== schedule.plannedStart || schedule.forecastEnd !== schedule.plannedEnd) && (
                <div className="mt-2 rounded-lg border border-pending/25 bg-pending-weak px-2.5 py-2 text-[11px] text-pending" role="status">
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span>{t('wbs.forecastSchedule')}</span>
                    {schedule.forecastConfidence === 'estimated' && <span>{t('wbs.forecastEstimated')}</span>}
                  </div>
                  <div className="mt-0.5 tabular-nums">
                    {fmtDate(schedule.forecastStart)} ~ {fmtDate(schedule.forecastEnd)}
                    {schedule.delayBusinessDays > 0 && ` · +${schedule.delayBusinessDays}${t('wbs.businessDaysUnit')}`}
                  </div>
                </div>
              )}

              {/* 시작 가능 여부 — 선행 FS/SS 충족 판정. unknown(선행 행 소실)은 접어 감추지 않고 그대로 드러낸다. */}
              {(incomingDependencies.length > 0 || unresolvedRefs.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {readiness.started && (
                  <span className="rounded-full border border-progress/35 bg-progress-weak px-2 py-0.5 text-[10px] font-bold text-progress">
                    {t('wbs.alreadyStarted')}
                  </span>
                )}
                {readiness.unknownCount > 0 ? (
                  <span className="rounded-full border border-delayed/35 bg-delayed-weak px-2 py-0.5 text-[10px] font-bold text-delayed" role="status">
                    {t('wbs.startUnknown').replace('{n}', String(readiness.unknownCount))}
                  </span>
                ) : readiness.waitingCount > 0 ? (
                  <span className="rounded-full border border-pending/35 bg-pending-weak px-2 py-0.5 text-[10px] font-bold text-pending" role="status">
                    {t('wbs.startBlocked').replace('{n}', String(readiness.waitingCount))}
                  </span>
                ) : (
                  <span className="rounded-full border border-done/35 bg-done-weak px-2 py-0.5 text-[10px] font-bold text-done" role="status">
                    {t('wbs.startReady')}
                  </span>
                )}
              </div>
              )}

              {depView === 'graph' ? (
                <div className="mt-2">
                  <DependencyEgoGraph
                    item={item}
                    predecessors={egoPredecessors}
                    successors={egoSuccessors}
                    onOpen={onSelectItem}
                    critical={schedule?.critical ?? false}
                    t={t}
                  />
                  {egoPredecessors.length === 0 && egoSuccessors.length === 0 && (
                    <p className="mt-2 text-xs text-ink-subtle">{t('wbs.noPredecessors')}</p>
                  )}
                </div>
              ) : (
              <div className="mt-2 space-y-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-ink-muted">{t('wbs.predecessors')}</div>
                  {incomingDependencies.length === 0 && unresolvedRefs.length === 0 ? (
                    <p className="text-xs text-ink-subtle">{t('wbs.noPredecessors')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {incomingDependencies.map(dep => (
                        <DependencyRow
                          key={dep.id}
                          linked={itemById.get(dep.predecessorId) ?? null}
                          badge={`${dep.type}${dep.lagDays > 0 ? ` +${dep.lagDays}` : ''}`}
                          badgeTitle={dep.type === 'FS' ? t('wbs.fsLong') : t('wbs.ssLong')}
                          state={readiness.byDependencyId.get(dep.id) ?? 'unknown'}
                          imported={dep.origin === 'spec'}
                          onOpen={onSelectItem}
                          onRemove={editable && dep.origin === 'manual' ? () => removeDependency(dep.id) : null}
                          removeDisabled={dependencyBusy}
                          t={t}
                        />
                      ))}
                      {/* 해석 못 한 depends — 가리킬 작업이 없어 이동도 삭제도 없다.
                          claim 이 409 를 내는 상태라 목록에서 빼면 '선행 없음 → 시작 가능'으로 위장한다. */}
                      {unresolvedRefs.map(ref => (
                        <DependencyRow
                          key={`unresolved:${ref}`}
                          linked={null}
                          missingLabel={lastRefSegment(ref)}
                          badge="FS"
                          badgeTitle={t('wbs.fsLong')}
                          state="unknown"
                          imported
                          onOpen={undefined}
                          onRemove={null}
                          removeDisabled={dependencyBusy}
                          t={t}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-[11px] font-semibold text-ink-muted">{t('wbs.successors')}</div>
                  {outgoingDependencies.length === 0 ? (
                    <p className="text-xs text-ink-subtle">{t('wbs.noSuccessors')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {outgoingDependencies.map(dep => (
                        <DependencyRow
                          key={dep.id}
                          linked={itemById.get(dep.successorId) ?? null}
                          badge={`${dep.type}${dep.lagDays > 0 ? ` +${dep.lagDays}` : ''}`}
                          badgeTitle={dep.type === 'FS' ? t('wbs.fsLong') : t('wbs.ssLong')}
                          state={null}
                          imported={dep.origin === 'spec'}
                          onOpen={onSelectItem}
                          onRemove={editable && dep.origin === 'manual' ? () => removeDependency(dep.id) : null}
                          removeDisabled={dependencyBusy}
                          t={t}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              )}

              {editable && dependencyOpen && (
                <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-2.5">
                  {predecessorCandidates.length === 0 ? (
                    <p className="text-xs text-ink-subtle">{t('wbs.noDependencyCandidates')}</p>
                  ) : (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.predecessorTask')}</span>
                        <select value={predecessorId} onChange={e => setPredecessorId(e.target.value)} className="app-input h-9 text-xs">
                          <option value="">{t('wbs.selectTask')}</option>
                          {predecessorCandidates.map(candidate => (
                            <option key={candidate.id} value={candidate.id}>{candidate.code ? `${candidate.code} · ` : ''}{candidate.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-[1fr_88px] gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.relationType')}</span>
                          <select value={dependencyType} onChange={e => setDependencyType(e.target.value as DependencyType)} className="app-input h-9 text-xs">
                            <option value="FS">{t('wbs.fsLong')}</option>
                            <option value="SS">{t('wbs.ssLong')}</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.lagDays')}</span>
                          <input type="number" min="0" max="365" step="1" value={lagDays} onChange={e => setLagDays(e.target.value)} className="app-input h-9 text-xs" />
                        </label>
                      </div>
                      <button type="button" onClick={addDependency} disabled={dependencyBusy || !predecessorId} className="btn btn-primary h-8 w-full text-xs">
                        {dependencyBusy ? t('wbs.saving') : t('wbs.connectTasks')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {dependencyErr && <p className="mt-2 text-xs font-medium text-delayed" role="alert">{dependencyErr}</p>}
              </>
              )}
            </section>
          )}

          {/* PMO 구조 편집 */}
          {editable && !editing && (
            <section className="rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{t('wbs.structureEdit')}</div>
              <div className="flex flex-wrap gap-2">
                {canChild && (
                  <button onClick={() => setAddName(addName == null ? '' : null)} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs">
                    <Plus className="h-3.5 w-3.5" /> {t('wbs.addChild')}
                  </button>
                )}
                {isAct && (
                  <button onClick={() => { setSubOpen(o => !o); setErr(null) }} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs">
                    <GitBranchPlus className="h-3.5 w-3.5" /> {t('wbs.addSubAct')}
                  </button>
                )}
                <button onClick={() => run(() => moveWbsItem(item.id, 'up'))} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs" aria-label={t('wbs.moveUp')}><ChevronUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => run(() => moveWbsItem(item.id, 'down'))} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs" aria-label={t('wbs.moveDown')}><ChevronDown className="h-3.5 w-3.5" /></button>
                <button onClick={() => setConfirmDel(true)} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-xs text-delayed hover:bg-delayed-weak"><Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}</button>
              </div>
              {addName != null && canChild && (
                <div className="mt-2 space-y-2">
                  {flipWarn && (
                    <p className="rounded-lg bg-pending-weak px-2.5 py-1.5 text-[11px] leading-snug text-pending">{t('wbs.addChildLeafWarn')}</p>
                  )}
                  <div className="flex gap-2">
                    <input autoFocus value={addName} onChange={e => setAddName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addChild() }} placeholder={`${levelLabels[item.depth + 1] ?? '항목'} ${t('wbs.namePlaceholderSuffix')}`} className="app-input h-8 text-xs" />
                    <button onClick={addChild} disabled={busy || !addName.trim()} className="btn btn-primary h-8 px-3 text-xs">{t('common.add')}</button>
                  </div>
                </div>
              )}
              {isAct && subOpen && (
                <div className="mt-2 space-y-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
                  {subTeams.length === 0 ? (
                    <p className="text-xs text-ink-subtle">{t('wbs.subActAllTeamsUsed')}</p>
                  ) : (
                    <>
                      {flipWarn && (
                        <p className="rounded-lg bg-pending-weak px-2.5 py-1.5 text-[11px] leading-snug text-pending">{t('wbs.subActLeafWarn')}</p>
                      )}
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-ink-muted">{t('wbs.subActTeam')}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {subTeams.map(tm => {
                            const on = subTeam === tm
                            return (
                              <button key={tm} onClick={() => setSubTeam(tm)}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-brand bg-brand-weak text-brand' : 'border-line text-ink-muted hover:bg-surface-2'}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${teamStyle(tm).bar}`} />{tm}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-ink-muted">{t('wbs.subActKind')}</div>
                        <div className="inline-flex rounded-lg border border-line p-0.5">
                          {(['primary', 'support'] as OwnerKind[]).map(k => (
                            <button key={k} onClick={() => setSubKind(k)}
                              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${subKind === k ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'}`}>
                              {k === 'primary' ? `● ${t('wbs.ownerPrimary')}` : `△ ${t('wbs.ownerSupport')}`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button onClick={addSub} disabled={busy || !subTeam} className="btn btn-primary h-8 w-full px-3 text-xs">{busy ? t('wbs.saving') : t('common.add')}</button>
                    </>
                  )}
                </div>
              )}
              {confirmDel && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-delayed-weak px-3 py-2 text-xs text-delayed">
                  <span className="flex-1">{t('wbs.deleteConfirm')}</span>
                  <button onClick={doDelete} disabled={busy} className="btn h-7 bg-delayed px-2.5 text-xs text-white">{t('common.delete')}</button>
                  <button onClick={() => setConfirmDel(false)} className="btn btn-ghost h-7 px-2.5 text-xs">{t('common.cancel')}</button>
                </div>
              )}
              {err && !editing && <p className="mt-2 text-xs font-medium text-delayed">{err}</p>}
            </section>
          )}

          {/* 산출물 첨부 */}
          <AttachmentSection itemId={item.id} canAttach={canAttach} />

          {/* 변경 이력 */}
          <ChangeHistoryList logs={logs} />
        </div>
      </aside>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums text-ink">{value}</div>
    </div>
  )
}

/** 산출물 파일 첨부 — 목록/다운로드(모두) + 업로드/삭제(담당팀·PMO). */
function AttachmentSection({ itemId, canAttach }: { itemId: string; canAttach: boolean }) {
  const router = useRouter()
  const { t } = useLocale()
  const [list, setList] = useState<DeliverableAttachment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    listAttachments(itemId).then(setList).catch(() => setList([]))
  }, [itemId])
  useEffect(() => { setList(null); load() }, [load])

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const safe = file.name.replace(/[^\w.\-가-힣]+/g, '_')
      const path = `${itemId}/${new Date().getTime()}-${safe}`
      const sb = createBrowserClient()
      const up = await sb.storage.from('deliverables').upload(path, file, { upsert: false })
      if (up.error) { setErr(t('wbs.uploadFail') + ': ' + up.error.message); return }
      const res = await recordAttachment(itemId, {
        fileName: file.name, filePath: path, size: file.size, mime: file.type || 'application/octet-stream',
      })
      if (!res.ok) {
        await sb.storage.from('deliverables').remove([path]) // 메타 기록 실패 시 객체 정리
        setErr(res.error ?? t('wbs.attachRecordFail')); return
      }
      load(); router.refresh()
    } catch {
      setErr(t('wbs.uploadError'))
    } finally { setBusy(false) }
  }

  async function del(id: string) {
    setBusy(true); setErr(null)
    const res = await removeAttachment(id)
    setBusy(false)
    if (!res.ok) { setErr(res.error ?? t('wbs.deleteFail')); return }
    load(); router.refresh()
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle"><Paperclip className="h-3.5 w-3.5" /> {t('wbs.attachments')}</div>
        {canAttach && (
          <label className="btn btn-ghost h-7 cursor-pointer px-2.5 text-xs">
            <Upload className="h-3.5 w-3.5" /> {busy ? t('wbs.processing') : t('wbs.addFile')}
            <input type="file" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        )}
      </div>
      {err && <p className="mb-2 text-xs font-medium text-delayed">{err}</p>}
      {list == null ? (
        <p className="text-sm text-ink-subtle">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-subtle">{canAttach ? t('wbs.noAttachmentsAdd') : t('wbs.noAttachments')}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <a href={a.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[13px] text-brand hover:underline" title={a.fileName}>{a.fileName}</a>
              {a.size != null && <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">{fmtSize(a.size)}</span>}
              {canAttach && <button onClick={() => del(a.id)} disabled={busy} aria-label={t('wbs.deleteAttachmentAria')} className="shrink-0 text-ink-subtle transition hover:text-delayed"><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 개요 정의표의 한 행 — dt/dd 를 감싸는 div 는 dl 안에서 유효하다(HTML5). */
/**
 * 개요 한 칸 — 라벨 위, 값 아래.
 *
 * 종전에는 라벨·값을 한 줄에 좌우로 놓고 항목마다 한 행을 썼는데, 다섯 항목이 세로로
 * 쌓여 패널 위쪽을 크게 잡아먹었다. 라벨을 값 위로 올리면 한 칸의 폭이 절반 이하로 줄어
 * 두 칸씩 나란히 놓을 수 있다(다섯 행 → 세 행).
 *
 * `span`=true 는 두 칸을 다 쓴다 — 산출물처럼 길고 편집 입력이 열리는 항목용.
 */
function DlRow({ label, children, span = false }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={`min-w-0 ${span ? 'col-span-2' : ''}`}>
      <dt className="text-[11px] font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-[13px] text-ink">{children}</dd>
    </div>
  )
}

/** external_ref('<module>/<id>')의 마지막 마디 — 목록에 모듈 접두어까지 늘어놓지 않는다. */
function lastRefSegment(ref: string): string {
  const i = ref.lastIndexOf('/')
  return i >= 0 ? ref.slice(i + 1) : ref
}

/** 선행·후속 한 줄 — 이름(클릭 시 그 작업으로 상세 이동) · 진행 상태 · 관계 배지 · 삭제.
 *  이름만 버튼으로 두는 이유: 행 전체를 버튼으로 감싸면 삭제 버튼이 버튼 안에 중첩된다. */
function DependencyRow({
  linked, missingLabel, badge, badgeTitle, state, imported = false, onOpen, onRemove, removeDisabled, t,
}: {
  linked: ComputedItem | null
  /** linked 가 없을 때 이름 자리에 쓸 문자열. 없으면 '알 수 없는 작업'. */
  missingLabel?: string
  badge: string
  badgeTitle: string
  /** 선행일 때만 충족 판정을 붙인다. 후속 행은 null. */
  state: PredecessorState | null
  /** wbs.md depends 에서 합성한 행인가. 정본이 파일이라 화면에서 지워도 다음 import 에 되살아난다. */
  imported?: boolean
  onOpen?: (id: string) => void
  onRemove: (() => void) | null
  removeDisabled: boolean
  t: (k: DictKey) => string
}) {
  const stateStyle: Record<PredecessorState, { label: DictKey; cls: string }> = {
    satisfied: { label: 'wbs.depSatisfied', cls: 'border-done/35 bg-done-weak text-done' },
    waiting: { label: 'wbs.depWaiting', cls: 'border-pending/35 bg-pending-weak text-pending' },
    unknown: { label: 'wbs.depUnknown', cls: 'border-delayed/35 bg-delayed-weak text-delayed' },
  }
  const name = linked?.name ?? missingLabel ?? t('wbs.missingTask')
  const label = (
    <>
      {linked?.code && <span className="mr-1 text-ink-subtle">{linked.code}</span>}
      {name}
    </>
  )
  return (
    <li className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs">
      <div className="flex items-center gap-2">
        {linked && onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(linked.id)}
            className="min-w-0 flex-1 truncate text-left text-ink underline-offset-2 transition hover:text-brand hover:underline"
            title={`${name} — ${t('wbs.openTaskDetail')}`}
          >
            {label}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink" title={name}>{label}</span>
        )}
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-bold text-ink-muted" title={badgeTitle}>{badge}</span>
        {imported && (
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-subtle" title={t('wbs.depImportedHint')}>
            {t('wbs.depImported')}
          </span>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} disabled={removeDisabled}
            aria-label={t('wbs.removeDependency')} className="shrink-0 text-ink-subtle transition hover:text-delayed">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {linked ? (
          <>
            <StatusChip status={linked.status} />
            <span className="tabular-nums text-[11px] text-ink-muted">{formatPct1(linked.rolledActualPct)}%</span>
          </>
        ) : (
          <span className="text-[11px] text-delayed">{t('wbs.depUnknown')}</span>
        )}
        {state && (
          <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold ${stateStyle[state].cls}`}>
            {t(stateStyle[state].label)}
          </span>
        )}
      </div>
    </li>
  )
}
