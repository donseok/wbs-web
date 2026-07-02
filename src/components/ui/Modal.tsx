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

  // autoFocus 자식이 있으면 effect 시점에는 이미 포커스가 모달 내부라 트리거를 알 수 없다.
  // 그 경우를 위해 닫힘→열림 전환 렌더(패널 DOM 생성 전) 시점의 activeElement를 캡처해 둔다.
  // 단, 연쇄 모달(A 닫힘+B 열림 한 커밋)에서는 이 스냅샷이 곧 detach될 A 내부 요소일 수
  // 있으므로 복원 대상은 아래 effect에서 하이브리드로 결정한다.
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  if (open !== wasOpenRef.current) {
    if (open && typeof document !== 'undefined') prevFocusRef.current = document.activeElement as HTMLElement | null
    wasOpenRef.current = open
  }

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    // 복원 대상(트리거) 하이브리드 결정: effect 시점 activeElement가 패널 밖이면 그것 —
    // 연쇄 모달에서는 앞 모달의 cleanup(destroy가 create보다 먼저)이 이 시점에 이미
    // 진짜 트리거로 포커스를 복원해 뒀다. 패널 안이면(autoFocus 자식 선점) 렌더 스냅샷이 트리거다.
    const active = document.activeElement as HTMLElement | null
    const autoFocused = !!panel && panel.contains(active)
    const previouslyFocused = autoFocused ? prevFocusRef.current : active
    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
        : []

    // 열릴 때 다이얼로그 안으로 포커스 이동(첫 포커서블, 없으면 패널) — autoFocus 선점 시 존중.
    if (!autoFocused) (focusables()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      // 포커스가 트랩 밖으로 샌 경우(저장 중 disabled 전환 등) 다시 안으로 회수.
      if (!panel?.contains(document.activeElement)) { e.preventDefault(); (f[0] ?? panel)?.focus(); return }
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
