'use client'
import { useState } from 'react'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'
import { ProgressBar } from './ProgressBar'

const STATUS_LABEL: Record<string, string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}

export function TreeTable({ items, selectedId, onSelect }: {
  items: ComputedItem[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setCollapsed(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const render = (nodes: ComputedItem[], depth: number): React.ReactNode[] =>
    nodes.flatMap(n => {
      const hasChildren = n.children.length > 0
      const isCollapsed = collapsed.has(n.id)
      const row = (
        <tr key={n.id} onClick={() => onSelect(n.id)}
          className={`cursor-pointer border-b text-sm ${selectedId === n.id ? 'bg-blue-50' : ''}`}>
          <td className="py-1" style={{ paddingLeft: depth * 16 }}>
            {hasChildren && (
              <button onClick={e => { e.stopPropagation(); toggle(n.id) }} className="mr-1">{isCollapsed ? '▸' : '▾'}</button>
            )}
            <span className={depth === 0 ? 'font-semibold' : ''}>{n.name}</span>
          </td>
          <td>{n.owners.map(o => (
            <span key={o.team} className={`mr-1 rounded px-1 text-xs ${o.kind === 'primary' ? 'bg-black text-white' : 'bg-gray-200'}`}>{o.team}</span>
          ))}</td>
          <td className="text-right tabular-nums">{n.plannedPct}%</td>
          <td className="text-right tabular-nums">{n.rolledActualPct}%</td>
          <td><ProgressBar planned={n.plannedPct} actual={n.rolledActualPct} /></td>
          <td className="text-xs">{STATUS_LABEL[n.status]}</td>
        </tr>
      )
      return isCollapsed ? [row] : [row, ...render(n.children, depth + 1)]
    })

  return (
    <table className="w-full border-collapse">
      <thead><tr className="border-b text-left text-xs text-gray-500">
        <th>작업</th><th>담당</th><th className="text-right">계획</th><th className="text-right">실적</th><th>진행</th><th>상태</th>
      </tr></thead>
      <tbody>{render(items, 0)}</tbody>
    </table>
  )
}
