'use client'
import { useEffect, useRef } from 'react'
import { Highlighter, Users } from 'lucide-react'
import type { InsightKind } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'

const KIND_CHIP: Record<InsightKind, string> = {
  decision: 'bg-done-weak text-done',
  action: 'bg-progress-weak text-progress',
  deadline: 'bg-accent-warning/15 text-accent-warning',
  risk: 'bg-delayed-weak text-delayed',
}

export interface PopoverState {
  blockIndex: number
  rect: { top: number; bottom: number; left: number; width: number }  // getBoundingClientRect 스냅샷
}

/** 블록 팝오버 — fixed 배치(블록 하단 우선·상단 플립·좌우 클램프), 스크롤/리사이즈/외부 클릭 시 닫힘. 스펙 §6.4. */
export function MinuteBlockPopover({
  state, mine, names, insKinds, busy, onToggle, onClose,
}: {
  state: PopoverState
  mine: boolean
  names: string[]
  insKinds: InsightKind[]
  busy: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // capture — 본문 카드 내부 스크롤도 감지. 단, 팝오버 내부 스크롤(긴 명단)은 닫지 않는다.
    const close = (e: Event) => {
      if (e.target instanceof Node && boxRef.current?.contains(e.target)) return
      onClose()
    }
    const closeAll = () => onClose()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', closeAll)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', closeAll)
    }
  }, [onClose])

  const W = 260
  const H = 240  // 최대 높이 추정치 — 명단 max-h-28 바운드로 실제 높이가 이 안에 든다
  const left = Math.min(Math.max(8, state.rect.left), window.innerWidth - W - 8)
  const below = state.rect.bottom + H < window.innerHeight
  const pos = below
    ? { top: state.rect.bottom + 6, left }
    : { top: Math.max(8, state.rect.top - 6 - H), left }

  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label="닫기" onClick={onClose} />
      <div ref={boxRef} style={{ position: 'fixed', width: W, ...pos }}
        className="z-[95] overflow-hidden rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-lg)]">
        {insKinds.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {insKinds.map(k => (
              <span key={k} className={`chip ${KIND_CHIP[k]}`}>{t(`min.insight.kind.${k}`)}</span>
            ))}
          </div>
        )}
        <button onClick={onToggle} disabled={busy}
          className={`btn h-9 w-full ${mine ? 'bg-accent-warning/15 text-accent-warning' : 'btn-ghost'}`}>
          <Highlighter className="h-4 w-4" />
          {mine ? t('min.hl.remove') : t('min.hl.add')}
        </button>
        {names.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-ink-subtle">
              <Users className="h-3 w-3" />{t('min.hl.people')}
            </p>
            <p className="max-h-28 overflow-y-auto overscroll-contain text-xs leading-relaxed text-ink-muted">{names.join(', ')}</p>
          </div>
        )}
      </div>
    </>
  )
}
