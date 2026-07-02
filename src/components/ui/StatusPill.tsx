'use client'

import type { Status } from '@/lib/domain/types'
import { STATUS } from '@/components/wbs/shared'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 상태 칩 — wbs/shared 의 STATUS 매핑 재사용. 라벨은 locale 사전(status.*)에서 표시. */
export function StatusPill({ status }: { status: Status }) {
  const { t } = useLocale()
  const s = STATUS[status]
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {t(`status.${status}` as DictKey)}
    </span>
  )
}
