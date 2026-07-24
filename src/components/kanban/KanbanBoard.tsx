'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Layers, Users, Columns3, Search, Inbox } from 'lucide-react'
import type { ComputedItem, Membership } from '@/lib/domain/types'
import { canEditActual } from '@/lib/domain/permissions'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  groupByPhase, groupByOwner, groupByProgress, bucketOf, dueSignal, leafPaths,
  type KanbanColumn, type ProgressBucket,
} from '@/lib/domain/kanban'
import { resolveDrop } from '@/lib/domain/kanban-drop'
import { statusOf } from '@/lib/domain/progress'
import { updateActual } from '@/app/actions/wbs'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { KanbanCard } from './KanbanCard'
import { ProgressPopover } from './ProgressPopover'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'

type Mode = 'progress' | 'phase' | 'owner'
type StatusFilter = 'all' | 'in_progress' | 'done'

// 표시 전용 매핑 — 도메인(src/lib/domain/kanban.ts)이 만드는 한국어 컬럼 제목을 번역 키로 변환.
// 매핑에 없는 값(동적 팀명·담당자명·Phase명)은 원본 그대로 표시한다.
const COLUMN_TITLE_KEY: Record<string, DictKey> = {
  '시작전': 'status.not_started',
  '진행중': 'status.in_progress',
  '지연': 'status.delayed',
  '완료': 'status.done',
  '미배정': 'kanban.unassigned',
}

export function KanbanBoard({
  projectId,
  items,
  membership,
  today,
  readOnly = false,
}: {
  projectId: string
  items: ComputedItem[]
  membership: Membership | null
  today: string
  /** 데모 모드 등에서 편집 어포던스 비활성화 */
  readOnly?: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const teamCodes = useTeamCodes()
  const searchParams = useSearchParams()
  // 챗봇 딥링크 ?view= 초기 모드 — 레거시 'status' 딥링크는 'progress'로 흡수, 무효 값은 조용히 무시(기본 progress).
  const [mode, setMode] = useState<Mode>(() => {
    const view = searchParams.get('view')
    if (view === 'phase' || view === 'owner' || view === 'progress') return view
    if (view === 'status') return 'progress'
    return 'progress'
  })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  // ?team= 은 검색어 초기값으로 소비한다 — 칸반 검색 대상에 담당팀 코드가 포함되며,
  // 검색창에 그대로 보여 사용자가 지울 수 있다(숨은 필터 금지).
  const [query, setQuery] = useState(() => {
    const team = searchParams.get('team')
    return team && teamCodes.includes(team) ? team : ''
  })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [confirmCard, setConfirmCard] = useState<ComputedItem | null>(null)
  const [promptState, setPromptState] = useState<{ card: ComputedItem; suggested: number } | null>(null)
  const [override, setOverride] = useState<Record<string, number>>({})
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [liveMsg, setLiveMsg] = useState('')
  // 같은 카드에 대한 commit 재진입 방지(더블클릭 등으로 두 번째 요청이 첫 번째보다 먼저 읽는 prev가
  // 이미 낙관적 override로 오염되는 것을 막는다) — 렌더와 무관한 동기 가드라 ref로 관리.
  const inFlightRef = useRef<Set<string>>(new Set())
  // 원본 items(override 미적용) 리프 조회 맵 — 재조정 시 "서버가 이 override를 아직 반영했는지" 판단용.
  const rawLeafById = useMemo(() => {
    const m = new Map<string, ComputedItem>()
    const walk = (ns: ComputedItem[]) => ns.forEach(n => { m.set(n.id, n); walk(n.children) })
    walk(items)
    return m
  }, [items])
  // 서버 데이터가 새로 오면, 서버 값이 아직 따라오지 못한 override만 남기고 나머지는 비운다(재조정).
  // savingIds는 여기서 일괄 리셋하지 않는다 — 카드별로 commit의 finally가 소유한다.
  useEffect(() => {
    setOverride(prev => {
      if (Object.keys(prev).length === 0) return prev
      const next: Record<string, number> = {}
      for (const [id, val] of Object.entries(prev)) {
        const leaf = rawLeafById.get(id)
        if (!leaf || leaf.rolledActualPct !== val) next[id] = val // 서버가 아직 이 값을 반영하지 않음 → 유지
      }
      return next
    })
  }, [rawLeafById])
  useBotPageContext({
    domain: 'kanban',
    projectId,
    view: mode,
    search: query || null,
    filters: statusFilter === 'all' ? {} : { status: statusFilter },
  })

  const editable = !readOnly && mode === 'progress'
  const cardEditable = (card: ComputedItem) => editable && canEditActual(card, membership)

  // 낙관적 override를 items 트리에 입힌 뷰. 저장 확정 전까지 카드가 즉시 옮겨 보이게 한다.
  const viewItems = useMemo<ComputedItem[]>(() => {
    const ids = Object.keys(override)
    if (ids.length === 0) return items
    const map = (ns: ComputedItem[]): ComputedItem[] => ns.map(n => {
      if (!n.children.length && override[n.id] !== undefined) {
        const pct = override[n.id]
        return { ...n, actualPct: pct, rolledActualPct: pct, status: statusOf(pct, n.plannedPct, n.plannedStart, today) }
      }
      if (n.children.length) return { ...n, children: map(n.children) }
      return n
    })
    return map(items)
  }, [items, override, today])

  const cardById = useMemo(() => {
    const m = new Map<string, ComputedItem>()
    const walk = (ns: ComputedItem[]) => ns.forEach(n => { m.set(n.id, n); walk(n.children) })
    walk(viewItems)
    return m
  }, [viewItems])

  // 리프 id → 조상 이름 배열(카드 breadcrumb 표시용).
  const pathById = useMemo(() => leafPaths(viewItems), [viewItems])

  const baseColumns = useMemo<KanbanColumn[]>(() => {
    if (mode === 'owner') return groupByOwner(viewItems, teamCodes)
    if (mode === 'phase') return groupByPhase(viewItems)
    return groupByProgress(viewItems)
  }, [mode, viewItems, teamCodes])

  const columns = useMemo<KanbanColumn[]>(() => {
    const q = query.trim().toLowerCase()
    return baseColumns.map(col => {
      const cards = col.cards.filter(card => {
        if (statusFilter === 'in_progress' && card.status !== 'in_progress') return false
        if (statusFilter === 'done' && card.status !== 'done') return false
        if (q) {
          const hay = `${card.name} ${card.code} ${card.owners.map(o => o.team).join(' ')}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      return { ...col, cards, count: cards.length }
    })
  }, [baseColumns, statusFilter, query])

  // 실적% 반영 — 낙관적으로 먼저 옮기고, 실패하면 롤백 + 토스트. CAS(expectedCurrent)로 동시 편집 충돌을 감지한다.
  // prev는 원시값(반올림 금지): 반올림하면 (a) 소수 실적(예: 99.6%)에서 가드가 조기 무력화돼 카드가 100%에 영영 못 닿고,
  // (b) updateActual의 CAS가 DB 원시값과 반올림값을 비교해 오탐 충돌을 낸다.
  async function commit(card: ComputedItem, pct: number) {
    const prev = card.rolledActualPct
    if (prev === pct) return
    if (inFlightRef.current.has(card.id)) return           // 같은 카드 재진입 방지(더블클릭 등)
    inFlightRef.current.add(card.id)
    setOverride(o => ({ ...o, [card.id]: pct }))            // 낙관적 이동
    setSavingIds(s => new Set(s).add(card.id))
    try {
      const res = await updateActual(card.id, pct, prev)   // CAS: expectedCurrent = 현재값
      if (!res.ok) {
        setOverride(o => { const n = { ...o }; delete n[card.id]; return n }) // 롤백
        toast({
          title: t('kanban.saveFailedTitle'),
          description: res.conflict ? t('kanban.conflict') : (res.error ?? t('kanban.errChange')),
          variant: 'error',
        })
        if (res.conflict) router.refresh()
        return
      }
      setLiveMsg(`${card.name} ${pct}%`)
      router.refresh() // 성공 확정 — 새 items 도착 시 useEffect가 override 비움
    } catch {
      setOverride(o => { const n = { ...o }; delete n[card.id]; return n })
      toast({ title: t('kanban.saveFailedTitle'), variant: 'error' })
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(card.id); return n })
      inFlightRef.current.delete(card.id)
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, columnKey: string) {
    e.preventDefault()
    setDragOverKey(null)
    const id = e.dataTransfer.getData('text/plain')
    setDraggingId(null)
    const card = id ? cardById.get(id) : undefined
    if (!card || !cardEditable(card)) return
    const r = resolveDrop(card, columnKey as ProgressBucket)
    if (r.kind === 'noop') return
    if (r.kind === 'set') commit(card, r.pct)
    else if (r.kind === 'confirm-reset') setConfirmCard(card)
    else if (r.kind === 'prompt') setPromptState({ card, suggested: r.suggested })
  }

  const stepCard = (card: ComputedItem, delta: number) =>
    commit(card, Math.max(0, Math.min(100, Math.round(card.rolledActualPct) + delta)))
  const startCard = (card: ComputedItem) => setPromptState({ card, suggested: 30 })
  const reopenCard = (card: ComputedItem) => setPromptState({ card, suggested: 90 })
  const openInWbs = (card: ComputedItem) => router.push(`/p/${projectId}/wbs?focus=${card.id}`)

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t('kanban.emptyTitle')}
        description={t('kanban.emptyDesc')}
      />
    )
  }

  return (
    // 헤드(툴바·안내)는 고정하고 보드만 남은 높이를 채운다 — 세로 스크롤은 컬럼 안에서만 일어난다.
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 툴바 */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs<Mode>
          value={mode}
          onChange={setMode}
          tabs={[
            { key: 'progress', label: t('kanban.byProgress'), icon: Columns3 },
            { key: 'phase', label: t('kanban.byPhase'), icon: Layers },
            { key: 'owner', label: t('kanban.byOwner'), icon: Users },
          ]}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SegmentedTabs<StatusFilter>
            size="sm"
            value={statusFilter}
            onChange={setStatusFilter}
            tabs={[
              { key: 'all', label: t('kanban.filterAll') },
              { key: 'in_progress', label: t('status.in_progress') },
              { key: 'done', label: t('status.done') },
            ]}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('kanban.searchPlaceholder')}
              aria-label={t('kanban.searchPlaceholder')}
              className="app-input pl-9 sm:w-64"
            />
          </div>
          {savingIds.size > 0 && <span className="text-[12px] text-brand">{t('kanban.saving')}</span>}
        </div>
      </div>

      {/* 조회 전용 힌트(진행 뷰가 아닐 때) */}
      {!editable && !readOnly && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-[12px] text-ink-subtle">
          {t('kanban.readOnlyHint')}
        </div>
      )}

      {/* 보드 */}
      <div className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto pb-2">
        {columns.map(col => {
          const draggingCard = draggingId ? cardById.get(draggingId) : undefined
          // 표시 시점에만 한국어 컬럼 제목을 번역 — 도메인의 Record 키('미배정' 등)는 건드리지 않는다.
          const titleKey = COLUMN_TITLE_KEY[col.title]
          const displayTitle = titleKey ? t(titleKey) : col.title
          const isDropZone = editable // 세 컬럼(시작전/진행중/완료) 모두 드롭 대상
          // 드래그 중인 카드를 이 컬럼이 받을 수 있을 때만 활성 하이라이트.
          const accepts = isDropZone && (!draggingCard || resolveDrop(draggingCard, col.key as ProgressBucket).kind !== 'noop')
          const active = accepts && dragOverKey === col.key && draggingId !== null
          return (
            <div
              key={col.key}
              onDragOver={isDropZone ? e => { if (accepts) { e.preventDefault(); setDragOverKey(col.key) } } : undefined}
              onDragLeave={isDropZone ? () => setDragOverKey(k => (k === col.key ? null : k)) : undefined}
              onDrop={isDropZone ? e => handleDrop(e, col.key) : undefined}
              className={`card flex max-h-full w-[286px] min-w-[286px] flex-col p-3 transition
                ${active ? 'border-brand ring-2 ring-brand-ring' : ''}`}
            >
              <header className="flex items-center justify-between gap-2 px-1 pb-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${col.accentDot ?? 'bg-brand'}`} />
                  <h3 className="truncate text-[13px] font-semibold text-ink" title={displayTitle}>{displayTitle}</h3>
                </div>
                <span className="badge shrink-0 bg-surface-2 text-ink-muted">{col.count}</span>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
                {col.cards.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line py-8 text-center text-[12px] text-ink-subtle">
                    {isDropZone ? t('kanban.dropHere') : t('kanban.noTasks')}
                  </div>
                ) : (
                  col.cards.map(card => {
                    const canDrag = cardEditable(card)
                    const b = bucketOf(card.rolledActualPct)
                    return (
                      <KanbanCard
                        key={card.id}
                        card={card}
                        bucket={b}
                        pathLabel={pathById.get(card.id)?.[0]}
                        due={dueSignal(card.plannedEnd, card.rolledActualPct, today)}
                        draggable={canDrag}
                        editable={canDrag}
                        dragging={draggingId === card.id}
                        saving={savingIds.has(card.id)}
                        onOpen={() => openInWbs(card)}
                        onStart={canDrag ? () => startCard(card) : undefined}
                        onStep={canDrag ? d => stepCard(card, d) : undefined}
                        onComplete={canDrag ? () => commit(card, 100) : undefined}
                        onReopen={canDrag ? () => reopenCard(card) : undefined}
                        onDragStart={canDrag ? e => {
                          e.dataTransfer.setData('text/plain', card.id)
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingId(card.id)
                        } : undefined}
                        onDragEnd={() => setDraggingId(null)}
                      />
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 스크린리더 진행률 변경 확정 안내 — 시각적으로는 숨김 */}
      <div aria-live="polite" className="sr-only">{liveMsg}</div>

      <Modal
        open={confirmCard !== null}
        onClose={() => setConfirmCard(null)}
        eyebrow="KANBAN"
        title={t('kanban.resetTitle')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setConfirmCard(null)}>{t('kanban.cancel')}</button>
            <button className="btn btn-primary" onClick={() => { if (confirmCard) commit(confirmCard, 0); setConfirmCard(null) }}>{t('kanban.resetConfirm')}</button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">{t('kanban.resetDesc')}</p>
      </Modal>

      {promptState && (
        <ProgressPopover
          open
          title={t('kanban.progressTitle')}
          initial={promptState.suggested}
          onClose={() => setPromptState(null)}
          onSubmit={pct => { commit(promptState.card, pct); setPromptState(null) }}
        />
      )}
    </div>
  )
}
