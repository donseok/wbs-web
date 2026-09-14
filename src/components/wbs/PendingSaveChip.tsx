'use client'

import { Clock } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * useDebouncedSave 의 대기 표시 — 「N초 뒤 저장」 카운트다운 + 「지금 저장」 버튼. 저장 중에는 「저장 중…」.
 * 대기도 저장도 아니면 아무것도 그리지 않는다(빈 패널에 소음을 더하지 않는다).
 * 패널 머리(접힘과 무관하게 항상 보이는 자리)에 둔다 — 본문을 접어도 대기 중이라는 사실은 보여야 한다.
 */
export function PendingSaveChip({ isPending, saving, remainingMs, onSaveNow }: {
  isPending: boolean
  saving: boolean
  remainingMs: number | null
  onSaveNow: () => void
}) {
  const { t } = useLocale()
  if (saving) {
    return (
      <span data-pending-save="saving" role="status" className="chip bg-surface-2 text-ink-muted">
        {t('wbs.saving')}
      </span>
    )
  }
  if (!isPending) return null
  const seconds = Math.max(1, Math.ceil((remainingMs ?? 0) / 1000))
  return (
    <span data-pending-save="pending" role="status" className="inline-flex items-center gap-1">
      <span className="chip inline-flex items-center gap-1 bg-brand-weak text-brand tabular-nums">
        <Clock className="h-3 w-3" />
        {t('wbs.pendingSaveIn').replace('{n}', String(seconds))}
      </span>
      <button
        type="button" data-pending-save-now onClick={onSaveNow}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand transition hover:bg-brand-weak"
      >
        {t('wbs.pendingSaveNow')}
      </button>
    </span>
  )
}
