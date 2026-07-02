'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** 접근성 모달 — Escape/백드롭 닫기 + 포커스 트랩/복원. 브라우저 alert/confirm 금지 대체. */
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
  const { t } = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)

  // onClose는 소비자가 인라인 화살표로 넘기는 게 보통이라 렌더마다 identity가 바뀐다.
  // 이를 effect 의존성에 넣으면 타이핑(리렌더)마다 트랩이 재설치되며 포커스를 빼앗으므로,
  // 최신 참조는 ref로 읽고 effect는 open 전환에만 반응한다.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
        : []

    // 열릴 때 다이얼로그 안으로 포커스 이동(첫 포커서블, 없으면 패널).
    ;(focusables()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (f.length === 0) { e.preventDefault(); return }
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // 닫힐 때 트리거로 포커스 복원.
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null
  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/45 backdrop-blur-sm" aria-label={t('common.close')} onClick={onClose} tabIndex={-1} />
      <div ref={panelRef} tabIndex={-1} className={`relative z-10 w-full ${width} overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-xl)] focus:outline-none`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{eyebrow}</div>}
            {title && <h2 className="mt-0.5 text-base font-bold tracking-tight text-ink">{title}</h2>}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted transition hover:text-ink" aria-label={t('common.close')}><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
