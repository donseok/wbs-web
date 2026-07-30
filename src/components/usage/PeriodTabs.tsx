import Link from 'next/link'
import { PERIOD_OPTIONS, usageHref } from '@/lib/domain/usage'

/**
 * 기간 선택 — 서버 렌더 유지를 위해 상태가 아니라 링크다.
 * 기간을 바꿔도 접속 로그의 사용자·메뉴 필터는 유지된다(usageHref 가 나머지를 보존).
 */
export function PeriodTabs({ filter }: { filter: { days: number; user?: string; menu?: string } }) {
  return (
    <div className="seg">
      {PERIOD_OPTIONS.map(d => (
        <Link
          key={d}
          href={usageHref(filter, { days: d })}
          className={`seg-item ${filter.days === d ? 'seg-item-active' : ''}`}
          aria-current={filter.days === d ? 'page' : undefined}
        >
          {d}일
        </Link>
      ))}
    </div>
  )
}
