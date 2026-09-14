import type React from 'react'
import type { Seatmap } from '@/lib/domain/seatmap'
import css from './seatmap.module.css'

const ITEMS: Array<{ key: keyof Seatmap['counters']; label: string; sub: string; dot: string }> = [
  { key: 'active', label: 'Active', sub: '업무 중', dot: 'var(--sm-active)' },
  { key: 'standby', label: 'Standby', sub: '감시 중', dot: 'var(--sm-standby)' },
  { key: 'idle', label: 'Idle', sub: '승인 대기', dot: 'var(--sm-wait)' },
  { key: 'offline', label: 'Offline', sub: '빈자리·끊김', dot: '#B7BFBA' },
]

export function Counters({ counters }: { counters: Seatmap['counters'] }) {
  return (
    <ul className={css.counters} aria-label="현황">
      {ITEMS.map(it => (
        <li key={it.key} className={css.counter} style={{ '--sm-dot': it.dot } as React.CSSProperties}>
          <b data-counter={it.key}>{counters[it.key]}</b><span>{it.label}</span><em>{it.sub}</em>
        </li>
      ))}
    </ul>
  )
}
