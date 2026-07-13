'use client'

import type { ReactNode } from 'react'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { fmtDate } from '@/components/wbs/shared'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export interface DayPopoverAnchor {
  date: string // 'YYYY-MM-DD'
  rect: { top: number; bottom: number; left: number }  // getBoundingClientRect 스냅샷
}

/** 달력 "+N건" 팝오버 셸 — fixed 배치(셀 하단 우선·상단 플립·좌우 클램프), 외부 클릭 시 닫힘. */
export function DayPopover({ anchor, count, onClose, children }: {
  anchor: DayPopoverAnchor
  count: number
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useLocale()
  const dow = new Date(`${anchor.date}T00:00:00`).getDay()
  const W = 264
  const H = 300  // 최대 높이 추정치 — 목록 max-h 바운드로 실제 높이가 이 안에 든다
  const left = Math.min(Math.max(8, anchor.rect.left - 8), window.innerWidth - W - 8)
  const below = anchor.rect.bottom + H < window.innerHeight
  const pos = below
    ? { top: anchor.rect.bottom + 6, left }
    : { top: Math.max(8, anchor.rect.top - 6 - H), left }
  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label={t('common.close')} onClick={onClose} />
      <div style={{ position: 'fixed', width: W, ...pos }}
        className="z-[95] overflow-hidden rounded-2xl border border-line bg-surface p-2.5 shadow-[var(--shadow-lg)]">
        <p className="mb-1.5 px-1 text-[11px] font-semibold text-ink-subtle">
          {fmtDate(anchor.date)} ({t(`att.weekday.${WEEKDAY_KEYS[dow]}` as DictKey)}) · {count}
        </p>
        <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </>
  )
}
