'use client'

import { useMemo, useState, useTransition, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Users, Columns3, Search, Inbox, MoveHorizontal } from 'lucide-react'
import type { ComputedItem, Membership } from '@/lib/domain/types'
import { canEditActual } from '@/lib/domain/permissions'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { groupByPhase, groupByOwner, groupByStatus, type KanbanColumn } from '@/lib/domain/kanban'
import { updateActual } from '@/app/actions/wbs'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { KanbanCard } from './KanbanCard'

type Mode = 'phase' | 'owner' | 'status'
type StatusFilter = 'all' | 'in_progress' | 'done'

// 상태별 모드에서 드롭 시 실적값 매핑(완료=100, 시작전=0). 그 외 컬럼은 드롭 불가.
const DROP_TARGET: Record<string, number> = { done: 100, not_started: 0 }

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
  items,
  membership,
  today,
  readOnly = false,
}: {
  items: ComputedItem[]
  membership: Membership | null
  today: string
  /** 데모 모드 등에서 편집 어포던스 비활성화 */
  readOnly?: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [mode, setMode] = useState<Mode>('phase')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [liveMsg, setLiveMsg] = useState('')
  const [pending, startTransition] = useTransition()

  const editable = !readOnly && mode === 'status'

  // 카드가 이미 시작됐는지(기준일이 시작일 이후) — '시작전' 드롭 유효성 판정용.
  const started = (card: ComputedItem) => !!card.plannedStart && today >= card.plannedStart
  const cardEditable = (card: ComputedItem) => editable && canEditActual(card, membership)

  const cardById = useMemo(() => {
    const m = new Map<string, ComputedItem>()
    const walk = (ns: ComputedItem[]) => ns.forEach(n => { m.set(n.id, n); walk(n.children) })
    walk(items)
    return m
  }, [items])

  // 드롭 대상 컬럼이 이 카드를 받을 수 있는가(드롭 결과 상태 == 컬럼).
  const dropValidFor = (card: ComputedItem, columnKey: string): boolean => {
    if (!cardEditable(card) || DROP_TARGET[columnKey] === undefined) return false
    if (columnKey === 'done') return true
    if (columnKey === 'not_started') return !started(card) // 시작된 작업을 0%로 두면 '지연'이 되므로 불가
    return false
  }

  const baseColumns = useMemo<KanbanColumn[]>(() => {
    if (mode === 'owner') return groupByOwner(items)
    if (mode === 'status') return groupByStatus(items)
    return groupByPhase(items)
  }, [mode, items])

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

  function commitActual(card: ComputedItem, target: number, landingLabel: string) {
    startTransition(async () => {
      const res = await updateActual(card.id, target)
      if (!res.ok) {
        setErrorMsg(res.error ?? t('kanban.errStatusChange'))
        return
      }
      setLiveMsg(`${t('kanban.movedP1')}${card.name}${t('kanban.movedP2')}${landingLabel}${t('kanban.movedP3')}`)
      router.refresh()
    })
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, columnKey: string) {
    e.preventDefault()
    setDragOverKey(null)
    const id = e.dataTransfer.getData('text/plain')
    setDraggingId(null)
    const card = id ? cardById.get(id) : undefined
    if (!card) return
    if (!dropValidFor(card, columnKey)) {
      if (columnKey === 'not_started' && started(card)) {
        setErrorMsg(t('kanban.errNotStartedDrop'))
      }
      return
    }
    commitActual(card, DROP_TARGET[columnKey], columnKey === 'done' ? t('status.done') : t('status.not_started'))
  }

  // 키보드 토글(Enter/Space): 완료↔초기화. 상태는 계산값이라 토글 의미로만 동작.
  function keyboardToggle(card: ComputedItem) {
    if (!cardEditable(card)) return
    if (card.status === 'done') {
      setLiveMsg(`${t('kanban.clearedP1')}${card.name}${t('kanban.clearedP2')}`)
      startTransition(async () => {
        const res = await updateActual(card.id, 0)
        if (!res.ok) setErrorMsg(res.error ?? t('kanban.errChange'))
        else router.refresh()
      })
    } else {
      commitActual(card, 100, t('status.done'))
    }
  }

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
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs<Mode>
          value={mode}
          onChange={setMode}
          tabs={[
            { key: 'phase', label: t('kanban.byPhase'), icon: Layers },
            { key: 'owner', label: t('kanban.byOwner'), icon: Users },
            { key: 'status', label: t('kanban.byStatus'), icon: Columns3 },
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
        </div>
      </div>

      {/* 드래그 안내 (상태별 + 편집 권한) */}
      {editable && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-[12px] text-ink-muted">
          <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-brand" />
          {t('kanban.hint1')}<span className="font-semibold text-done">{t('status.done')}</span>{t('kanban.hint2')}
          <span className="font-semibold text-pending">{t('status.not_started')}</span>{t('kanban.hint3')}
          {pending && <span className="ml-1 text-brand">{t('kanban.saving')}</span>}
        </div>
      )}

      {/* 보드 */}
      <div className="flex items-start gap-4 overflow-x-auto pb-2">
        {columns.map(col => {
          const draggingCard = draggingId ? cardById.get(draggingId) : undefined
          // 표시 시점에만 한국어 컬럼 제목을 번역 — 도메인의 Record 키('미배정' 등)는 건드리지 않는다.
          const titleKey = COLUMN_TITLE_KEY[col.title]
          const displayTitle = titleKey ? t(titleKey) : col.title
          const isDropZone = editable && DROP_TARGET[col.key] !== undefined
          // 드래그 중인 카드를 이 컬럼이 받을 수 있을 때만 활성 하이라이트.
          const accepts = isDropZone && (!draggingCard || dropValidFor(draggingCard, col.key))
          const active = accepts && dragOverKey === col.key && draggingId !== null
          return (
            <div
              key={col.key}
              onDragOver={isDropZone ? e => { if (accepts) { e.preventDefault(); setDragOverKey(col.key) } } : undefined}
              onDragLeave={isDropZone ? () => setDragOverKey(k => (k === col.key ? null : k)) : undefined}
              onDrop={isDropZone ? e => handleDrop(e, col.key) : undefined}
              className={`card flex max-h-[calc(100vh-15rem)] w-[286px] min-w-[286px] flex-col p-3 transition
                ${active ? 'border-brand ring-2 ring-brand-ring' : ''}`}
            >
              <header className="flex items-center justify-between gap-2 px-1 pb-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${col.accentDot ?? 'bg-brand'}`} />
                  <h3 className="truncate text-[13px] font-semibold text-ink" title={displayTitle}>{displayTitle}</h3>
                </div>
                <span className="badge shrink-0 bg-surface-2 text-ink-muted">{col.count}</span>
              </header>

              <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
                {col.cards.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line py-8 text-center text-[12px] text-ink-subtle">
                    {isDropZone ? t('kanban.dropHere') : t('kanban.noTasks')}
                  </div>
                ) : (
                  col.cards.map(card => {
                    const canDragCard = cardEditable(card)
                    return (
                      <KanbanCard
                        key={card.id}
                        card={card}
                        draggable={canDragCard}
                        interactive={canDragCard}
                        dragging={draggingId === card.id}
                        onActivate={canDragCard ? () => keyboardToggle(card) : undefined}
                        onDragStart={canDragCard ? e => {
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

      {/* 스크린리더 상태 알림 */}
      <div aria-live="polite" className="sr-only">{liveMsg}</div>

      <Modal
        open={errorMsg !== null}
        onClose={() => setErrorMsg(null)}
        eyebrow="KANBAN"
        title={t('kanban.errorModalTitle')}
        footer={
          <button className="btn btn-primary" onClick={() => setErrorMsg(null)}>{t('common.confirm')}</button>
        }
      >
        <p className="text-sm leading-6 text-ink-muted">{errorMsg}</p>
      </Modal>
    </div>
  )
}
