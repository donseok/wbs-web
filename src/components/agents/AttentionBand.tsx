import type { Attention } from '@/lib/domain/seatmap'
import { STATE_LABEL } from './Seat'
import css from './seatmap.module.css'

export function AttentionBand({ items, onSelect }: { items: Attention[]; onSelect: (orderId: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className={css.alert} role="region" aria-label="확인 필요">
      <strong>확인 필요</strong>
      <ul className={css.alertList}>
        {items.map(a => (
          <li key={a.orderId}>
            <button type="button" className={css.alertBtn} onClick={() => onSelect(a.orderId)}>
              <b>{a.code}</b> {a.name} · {STATE_LABEL[a.state]} · {a.why}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
