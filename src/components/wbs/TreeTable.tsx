'use client'
import type { ComputedItem } from '@/lib/domain/types'
import { ProgressBar } from './ProgressBar'

const STATUS: Record<string, { label: string; cls: string }> = {
  not_started: { label: '시작전', cls: 'bg-pending-weak text-pending' },
  in_progress: { label: '진행중', cls: 'bg-progress-weak text-progress' },
  delayed: { label: '지연', cls: 'bg-delayed-weak text-delayed' },
  done: { label: '완료', cls: 'bg-done-weak text-done' },
}

// 엑셀 격자: 모든 셀 공통 보더 + box-border 로 행 높이 정확히 24px 유지(간트와 정렬)
const CELL = 'box-border h-6 border-b border-r border-grid px-2 align-middle'
const HEAD = 'box-border h-12 border-b-2 border-r border-grid-strong bg-sheet-head px-2 align-middle font-semibold text-ink-muted'

export function TreeTable({ items, selectedId, onSelect, collapsed, onToggle }: {
  items: ComputedItem[]; selectedId: string | null; onSelect: (id: string) => void
  collapsed: Set<string>; onToggle: (id: string) => void
}) {
  const ctr = { n: 0 }

  const render = (nodes: ComputedItem[], depth: number): React.ReactNode[] =>
    nodes.flatMap(n => {
      const hasChildren = n.children.length > 0
      const isCollapsed = collapsed.has(n.id)
      const isSel = selectedId === n.id
      const rowNo = ++ctr.n
      const st = STATUS[n.status]

      // 아웃라인 그룹 배경: phase=강조, task=중간, activity=제브라
      let rowBg: string
      if (isSel) rowBg = 'bg-brand-weak'
      else if (n.level === 'phase') rowBg = 'bg-sheet-head'
      else if (n.level === 'task') rowBg = 'bg-surface-2'
      else rowBg = rowNo % 2 === 0 ? 'bg-zebra' : 'bg-surface'

      const nameWeight = n.level === 'phase' ? 'font-semibold text-ink' : n.level === 'task' ? 'font-medium text-ink' : 'text-ink'

      const row = (
        <tr
          key={n.id}
          onClick={() => onSelect(n.id)}
          className={`group cursor-pointer ${rowBg} ${isSel ? '' : 'hover:bg-brand-weak/50'}`}
        >
          {/* 행 번호 거터 */}
          <td className={`${CELL} bg-sheet-gutter px-0 text-center text-[11px] tabular-nums text-ink-subtle ${isSel ? 'text-brand' : ''}`}>
            {rowNo}
          </td>
          {/* 작업명 (들여쓰기 + 토글) */}
          <td className={CELL}>
            <div className="flex items-center" style={{ paddingLeft: depth * 16 }}>
              {hasChildren ? (
                <button
                  onClick={e => { e.stopPropagation(); onToggle(n.id) }}
                  className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-ink-subtle hover:bg-line hover:text-ink"
                  aria-label={isCollapsed ? '펼치기' : '접기'}
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>
              ) : (
                <span className="mr-1 w-4 shrink-0" />
              )}
              <span className={`truncate ${nameWeight}`}>{n.name}</span>
            </div>
          </td>
          {/* 담당 */}
          <td className={CELL}>
            <div className="flex flex-wrap gap-1">
              {n.owners.map(o => (
                <span
                  key={o.team}
                  className={`badge ${o.kind === 'primary' ? 'bg-brand text-brand-fg' : 'border border-line bg-surface-2 text-ink-muted'}`}
                >
                  {o.team}
                </span>
              ))}
            </div>
          </td>
          {/* 계획% */}
          <td className={`${CELL} text-right tabular-nums text-ink-muted`}>{n.plannedPct}%</td>
          {/* 실적% */}
          <td className={`${CELL} text-right font-medium tabular-nums ${n.status === 'delayed' ? 'text-delayed' : 'text-ink'}`}>{n.rolledActualPct}%</td>
          {/* 진행 */}
          <td className={CELL}><ProgressBar planned={n.plannedPct} actual={n.rolledActualPct} /></td>
          {/* 상태 */}
          <td className={`${CELL} text-center`}>
            <span className={`badge ${st.cls}`}>{st.label}</span>
          </td>
        </tr>
      )
      return isCollapsed ? [row] : [row, ...render(n.children, depth + 1)]
    })

  return (
    <table className="w-full min-w-[560px] border-separate border-spacing-0 border-l border-t border-grid text-sm">
      <thead className="sticky top-0 z-10">
        <tr>
          <th className={`${HEAD} w-9 bg-sheet-gutter text-center`}>#</th>
          <th className={`${HEAD} text-left`}>작업</th>
          <th className={`${HEAD} text-left`}>담당</th>
          <th className={`${HEAD} w-14 text-right`}>계획</th>
          <th className={`${HEAD} w-14 text-right`}>실적</th>
          <th className={`${HEAD} w-28`}>진행</th>
          <th className={`${HEAD} w-16 text-center`}>상태</th>
        </tr>
      </thead>
      <tbody>{render(items, 0)}</tbody>
    </table>
  )
}
