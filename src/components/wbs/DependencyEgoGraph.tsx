'use client'

import { useState } from 'react'
import type { ComputedItem } from '@/lib/domain/types'
import type { PredecessorState } from '@/lib/domain/dependencyReadiness'
import type { DictKey } from '@/lib/i18n/dict'
import { formatPct1 } from '@/lib/domain/format'

/**
 * 선택된 작업 하나를 가운데 놓고 왼쪽에 선행, 오른쪽에 후행을 그리는 깊이 1 그래프.
 *
 * 전체 프로젝트 그래프가 아니라 **에고 그래프**라 레이아웃 엔진이 필요 없다.
 * 노드 높이를 고정해 두면 연결선 좌표가 인덱스 산수로 나오므로 측정(ResizeObserver)도 없다 —
 * 상세 패널은 드래그로 폭이 바뀌는데, 측정 기반이면 그때마다 다시 재야 한다.
 */

/** 노드 한 칸의 높이·간격. 연결선 좌표가 이 두 값에서 파생되므로 CSS 와 반드시 같이 움직인다. */
const NODE_H = 56
const NODE_GAP = 10
const ROW_H = NODE_H + NODE_GAP
/** 한 열에 이만큼 넘게 쌓이면 접는다 — 패널이 조용히 길어지지 않게. */
const COLLAPSE_AT = 8

const COL_W = 150
const CENTER_W = 168
const GUTTER_W = 40

export interface EgoNode {
  /** React key 이자 연결선 식별자. 미해석 ref 는 `unresolved:<ref>`. */
  key: string
  /** 이동 대상. 미해석 ref 는 null(가리킬 작업이 없다). */
  item: ComputedItem | null
  /** 미해석 ref 일 때 이름 자리에 찍을 문자열. */
  fallbackLabel?: string
  /** 선행일 때만. 후행 노드는 null. */
  state: PredecessorState | null
  /** wbs.md depends 에서 합성된 관계인가. */
  imported: boolean
  /** 'FS'·'SS +2' 같은 관계 배지. */
  badge: string
}

const STATE_STYLE: Record<PredecessorState, { label: DictKey; cls: string }> = {
  satisfied: { label: 'wbs.depSatisfied', cls: 'border-done/35 bg-done-weak text-done' },
  waiting: { label: 'wbs.depWaiting', cls: 'border-pending/35 bg-pending-weak text-pending' },
  unknown: { label: 'wbs.depUnknown', cls: 'border-delayed/35 bg-delayed-weak text-delayed' },
}

/** 좌측 색바 — 상태를 한눈에. StatusChip 과 같은 어휘를 쓴다. */
const STATUS_BAR: Record<ComputedItem['status'], string> = {
  done: 'bg-done',
  in_progress: 'bg-progress',
  delayed: 'bg-delayed',
  not_started: 'bg-ink-subtle/40',
}

export function DependencyEgoGraph({
  item,
  predecessors,
  successors,
  onOpen,
  critical = false,
  t,
}: {
  item: ComputedItem
  predecessors: EgoNode[]
  successors: EgoNode[]
  /** 더블클릭·Enter 로 그 작업의 상세를 연다. */
  onOpen?: (id: string) => void
  critical?: boolean
  t: (k: DictKey) => string
}) {
  const [expanded, setExpanded] = useState(false)

  const predShown = expanded ? predecessors : predecessors.slice(0, COLLAPSE_AT)
  const succShown = expanded ? successors : successors.slice(0, COLLAPSE_AT)
  const hiddenCount = (predecessors.length - predShown.length) + (successors.length - succShown.length)

  // 접힘 안내 칩도 한 칸을 차지한다 — 연결선 좌표가 열 높이에서 나오므로 칸 수에 포함시킨다.
  const predSlots = predShown.length + (predecessors.length > predShown.length ? 1 : 0)
  const succSlots = succShown.length + (successors.length > succShown.length ? 1 : 0)
  const rows = Math.max(predSlots, succSlots, 1)
  const boardH = rows * ROW_H - NODE_GAP

  /** i 번째 노드의 세로 중심. 블록이 열 안에서 가운데 정렬돼 있으므로 그만큼 밀어준다. */
  const centerYOf = (index: number, slots: number) =>
    (boardH - (slots * ROW_H - NODE_GAP)) / 2 + index * ROW_H + NODE_H / 2
  const hubY = boardH / 2

  return (
    <div className="overflow-x-auto">
      <div
        className="relative flex items-start gap-0"
        style={{ width: COL_W * 2 + CENTER_W + GUTTER_W * 2, height: boardH }}
      >
        <Column width={COL_W} boardH={boardH} slots={predSlots} align="right">
          {predShown.map(node => (
            <Node key={node.key} node={node} onOpen={onOpen} t={t} />
          ))}
          {predecessors.length > predShown.length && (
            <MoreChip count={predecessors.length - predShown.length} onClick={() => setExpanded(true)} t={t} />
          )}
        </Column>

        <Edges
          width={GUTTER_W}
          height={boardH}
          from={predShown.map((_, i) => centerYOf(i, predSlots))}
          to={hubY}
          direction="in"
        />

        <div className="flex shrink-0 items-center" style={{ width: CENTER_W, height: boardH }}>
          <div
            className={`w-full rounded-lg border-2 bg-surface px-2.5 py-1.5 ${critical ? 'border-critical' : 'border-brand-ring'}`}
            style={{ height: NODE_H }}
            aria-current="true"
          >
            <div className="truncate text-[10px] font-bold tabular-nums text-brand">{item.code}</div>
            <div className="truncate text-xs font-semibold text-ink" title={item.name}>{item.name}</div>
            <div className="truncate text-[10px] tabular-nums text-ink-muted">
              {formatPct1(item.rolledActualPct)}%
            </div>
          </div>
        </div>

        <Edges
          width={GUTTER_W}
          height={boardH}
          from={succShown.map((_, i) => centerYOf(i, succSlots))}
          to={hubY}
          direction="out"
        />

        <Column width={COL_W} boardH={boardH} slots={succSlots} align="left">
          {succShown.map(node => (
            <Node key={node.key} node={node} onOpen={onOpen} t={t} />
          ))}
          {successors.length > succShown.length && (
            <MoreChip count={successors.length - succShown.length} onClick={() => setExpanded(true)} t={t} />
          )}
        </Column>
      </div>

      {expanded && hiddenCount === 0 && predecessors.length + successors.length > COLLAPSE_AT && (
        <button type="button" onClick={() => setExpanded(false)} className="btn btn-ghost mt-1 h-6 px-2 text-[10px]">
          {t('wbs.depGraphCollapse')}
        </button>
      )}
    </div>
  )
}

function Column({
  width, boardH, slots, align, children,
}: {
  width: number
  boardH: number
  slots: number
  align: 'left' | 'right'
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex shrink-0 flex-col justify-center ${align === 'right' ? 'items-end' : 'items-start'}`}
      style={{ width, height: boardH, gap: NODE_GAP }}
      // slots 는 연결선 좌표 계산과 짝이다 — 렌더 결과와 어긋나면 선이 노드를 빗나간다.
      data-slots={slots}
    >
      {children}
    </div>
  )
}

/**
 * 한쪽 열과 가운데를 잇는 선. 팔꿈치 한 번 꺾어 그린다.
 * `direction`='in' 은 선행→가운데(오른쪽을 향한 화살표), 'out' 은 가운데→후행.
 */
function Edges({
  width, height, from, to, direction,
}: {
  width: number
  height: number
  from: number[]
  to: number
  direction: 'in' | 'out'
}) {
  const markerId = `ego-arrow-${direction}`
  return (
    <svg
      className="shrink-0 overflow-visible"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-ink-subtle)" />
        </marker>
      </defs>
      {from.map((y, i) => {
        // 'in': 노드 오른쪽 끝(x=0)에서 시작해 가운데 노드 왼쪽(x=width)으로.
        // 'out': 가운데 노드 오른쪽(x=0)에서 시작해 후행 노드 왼쪽(x=width)으로.
        const startY = direction === 'in' ? y : to
        const endY = direction === 'in' ? to : y
        const mid = width / 2
        return (
          <path
            key={i}
            d={`M 0 ${startY} H ${mid} V ${endY} H ${width}`}
            fill="none"
            stroke="var(--color-ink-subtle)"
            strokeWidth={1}
            markerEnd={`url(#${markerId})`}
          />
        )
      })}
    </svg>
  )
}

function Node({
  node, onOpen, t,
}: {
  node: EgoNode
  onOpen?: (id: string) => void
  t: (k: DictKey) => string
}) {
  const target = node.item
  const canOpen = !!target && !!onOpen
  const name = target?.name ?? node.fallbackLabel ?? t('wbs.missingTask')
  const open = () => { if (target && onOpen) onOpen(target.id) }

  return (
    <div
      className={`flex w-full items-stretch overflow-hidden rounded-lg border border-line bg-surface ${
        canOpen ? 'cursor-pointer transition hover:border-brand-ring hover:bg-brand-weak/40' : ''
      }`}
      style={{ height: NODE_H }}
      // 이동은 더블클릭이다 — 한 번 클릭으로 상세가 갈아끼워지면 그래프를 훑어볼 수가 없다.
      onDoubleClick={canOpen ? open : undefined}
      // 더블클릭에는 키보드 대응물이 없다. 포커스 가능한 노드에 Enter 를 같은 동작으로 붙인다.
      onKeyDown={canOpen ? (e => { if (e.key === 'Enter') { e.preventDefault(); open() } }) : undefined}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      title={canOpen ? `${name} — ${t('wbs.depGraphOpenHint')}` : name}
    >
      <span className={`w-1 shrink-0 ${target ? STATUS_BAR[target.status] : 'bg-delayed'}`} aria-hidden />
      <div className="min-w-0 flex-1 px-2 py-1">
        <div className="flex items-center gap-1">
          <span className="min-w-0 truncate text-[10px] font-bold tabular-nums text-ink-subtle">
            {target?.code ?? node.fallbackLabel ?? ''}
          </span>
          <span className="ml-auto shrink-0 rounded bg-surface-2 px-1 text-[9px] font-bold text-ink-muted">
            {node.badge}
          </span>
        </div>
        <div className="truncate text-[11px] text-ink">{name}</div>
        <div className="flex items-center gap-1">
          {target && (
            <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
              {formatPct1(target.rolledActualPct)}%
            </span>
          )}
          {node.imported && (
            <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] font-bold text-ink-subtle">
              {t('wbs.depImported')}
            </span>
          )}
          {node.state && (
            <span className={`ml-auto shrink-0 rounded-full border px-1.5 text-[9px] font-bold ${STATE_STYLE[node.state].cls}`}>
              {t(STATE_STYLE[node.state].label)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function MoreChip({ count, onClick, t }: { count: number; onClick: () => void; t: (k: DictKey) => string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center rounded-lg border border-dashed border-line text-[11px] text-ink-muted transition hover:border-brand-ring hover:text-brand"
      style={{ height: NODE_H }}
    >
      {t('wbs.depGraphMore').replace('{n}', String(count))}
    </button>
  )
}
