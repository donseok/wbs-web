'use client'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 본문 글자크기 컨트롤 — `A-  숫자  A+`(스펙 §4.3).
 * 상태를 갖지 않는 프레젠테이션 컴포넌트. 숫자 클릭은 기본값 리셋.
 */
export function MinuteFontSizeControl({
  size, onDec, onInc, onReset, canDec, canInc,
}: {
  size: number
  onDec: () => void
  onInc: () => void
  onReset: () => void
  canDec: boolean
  canInc: boolean
}) {
  const { t } = useLocale()
  const btn = 'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-muted transition '
    + 'hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    // shrink-0 — 헤더가 flex-wrap 이라 중간 폭에서 제목(flex-1 truncate)에 밀려 컨트롤이 찌그러지지 않게
    <div className="inline-flex shrink-0 items-center gap-0.5" role="group" aria-label={t('min.fs.group')}>
      <button type="button" onClick={onDec} disabled={!canDec}
        title={t('min.fs.decrease')} aria-label={t('min.fs.decrease')}
        className={`${btn} text-xs font-bold`}>
        A<span className="text-[10px]">−</span>
      </button>
      <button type="button" onClick={onReset}
        title={t('min.fs.reset')} aria-label={`${t('min.fs.current')}: ${size}px — ${t('min.fs.reset')}`}
        className="inline-flex h-7 min-w-[2rem] cursor-pointer items-center justify-center rounded-md px-1
                   text-xs tabular-nums text-ink-muted transition hover:bg-surface-2 hover:text-ink">
        <span aria-live="polite">{size}</span>
      </button>
      <button type="button" onClick={onInc} disabled={!canInc}
        title={t('min.fs.increase')} aria-label={t('min.fs.increase')}
        className={`${btn} text-sm font-bold`}>
        A<span className="text-[10px]">+</span>
      </button>
    </div>
  )
}
