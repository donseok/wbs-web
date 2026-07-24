'use client'

import { useLocale } from '@/components/providers/LocaleProvider'
import type { WbsFontScale } from '@/lib/wbsFontScale'

export function WbsFontSizeControl({
  scale,
  onDecrease,
  onIncrease,
  onReset,
  canDecrease,
  canIncrease,
}: {
  scale: WbsFontScale
  onDecrease: () => void
  onIncrease: () => void
  onReset: () => void
  canDecrease: boolean
  canIncrease: boolean
}) {
  const { t } = useLocale()
  const buttonClass = 'inline-flex h-7 w-7 items-center justify-center rounded-md font-bold text-ink-muted transition '
    + 'hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <div
      data-wbs-font-scale-control
      data-current-scale={scale}
      role="group"
      aria-label={t('wbs.fontSize')}
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-line bg-surface px-0.5 shadow-sm"
    >
      <button
        type="button"
        data-wbs-font-scale-decrease
        onClick={onDecrease}
        disabled={!canDecrease}
        title={t('wbs.fontDecrease')}
        aria-label={t('wbs.fontDecrease')}
        className={`${buttonClass} text-xs`}
      >
        A<span className="text-[10px]">−</span>
      </button>
      <button
        type="button"
        data-wbs-font-scale-reset
        onClick={onReset}
        title={t('wbs.fontReset')}
        aria-label={`${t('wbs.fontCurrent')}: ${scale}% — ${t('wbs.fontReset')}`}
        className="inline-flex h-7 min-w-10 items-center justify-center rounded-md px-1 text-[11px] tabular-nums text-ink-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <span aria-live="polite">{scale}%</span>
      </button>
      <button
        type="button"
        data-wbs-font-scale-increase
        onClick={onIncrease}
        disabled={!canIncrease}
        title={t('wbs.fontIncrease')}
        aria-label={t('wbs.fontIncrease')}
        className={`${buttonClass} text-sm`}
      >
        A<span className="text-[10px]">+</span>
      </button>
    </div>
  )
}
