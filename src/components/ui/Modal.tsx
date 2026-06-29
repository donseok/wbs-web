'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** 접근성 모달 — Escape/백드롭 닫기. 브라우저 alert/confirm 금지 대체. */
export function Modal({
  open, onClose, title, eyebrow, children, footer, size = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  if (!open) return null
  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/45 backdrop-blur-sm" aria-label="닫기" onClick={onClose} />
      <div className={`relative z-10 w-full ${width} overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-xl)]`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{eyebrow}</div>}
            {title && <h2 className="mt-0.5 text-base font-bold tracking-tight text-ink">{title}</h2>}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted transition hover:text-ink" aria-label="닫기"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
