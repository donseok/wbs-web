import Link from 'next/link'
import { PERIOD_OPTIONS } from '@/lib/domain/usage'

/** 기간 선택 — 서버 렌더 유지를 위해 상태가 아니라 링크다. */
export function PeriodTabs({ current }: { current: number }) {
  return (
    <div className="seg">
      {PERIOD_OPTIONS.map(d => (
        <Link
          key={d}
          href={`/usage?days=${d}`}
          className={`seg-item ${current === d ? 'seg-item-active' : ''}`}
          aria-current={current === d ? 'page' : undefined}
        >
          {d}일
        </Link>
      ))}
    </div>
  )
}
