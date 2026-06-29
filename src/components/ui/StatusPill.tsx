import type { Status } from '@/lib/domain/types'
import { STATUS } from '@/components/wbs/shared'

/** 상태 칩 — wbs/shared 의 STATUS 매핑 재사용. */
export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status]
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}
