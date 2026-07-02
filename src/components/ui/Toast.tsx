'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertTriangle, Info, X, type LucideIcon } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

type ToastVariant = 'success' | 'error' | 'info'

type ToastInput = { title: string; description?: string; variant?: ToastVariant }
type ToastItem = ToastInput & { id: number }

type ToastApi = { toast: (t: ToastInput) => void }

const ToastContext = createContext<ToastApi | null>(null)

/** 토스트를 띄우는 훅. `<ToastProvider>` 하위에서만 사용. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 는 <ToastProvider> 안에서만 사용할 수 있습니다.')
  return ctx
}

const AUTO_DISMISS_MS = 3500

const VARIANT: Record<ToastVariant, { icon: LucideIcon; iconWrap: string }> = {
  success: { icon: CheckCircle2, iconWrap: 'bg-done-weak text-done' },
  error: { icon: AlertTriangle, iconWrap: 'bg-delayed-weak text-delayed' },
  info: { icon: Info, iconWrap: 'bg-brand-weak text-brand' },
}

/** 앱을 감싸 토스트 스택을 제공한다. 우측 하단에 쌓이며 자동/수동으로 닫힌다. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput) => {
    seq.current += 1
    const item: ToastItem = { ...input, id: seq.current }
    setToasts(prev => [...prev, item])
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(92vw,360px)] flex-col gap-2.5"
        role="region"
        aria-label={t('ui.toastRegion')}
      >
        {toasts.map(item => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { t } = useLocale()
  const [shown, setShown] = useState(false)
  const meta = VARIANT[item.variant ?? 'info']
  const Icon = meta.icon

  // 진입 애니메이션 (prefers-reduced-motion 은 globals 의 transition 0.01ms 규칙으로 자동 처리)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // 자동 소멸 — 마우스를 올리면 일시정지
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const start = useCallback(() => {
    stop()
    timer.current = setTimeout(onDismiss, AUTO_DISMISS_MS)
  }, [onDismiss, stop])
  useEffect(() => {
    start()
    return stop
  }, [start, stop])

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={stop}
      onMouseLeave={start}
      className={`card pointer-events-auto flex items-start gap-3 p-3.5 pr-2.5 transition duration-200 ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
      style={{ boxShadow: 'var(--shadow-lg)' }}
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.iconWrap}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-semibold text-ink">{item.title}</div>
        {item.description && <div className="mt-0.5 text-xs leading-5 text-ink-muted">{item.description}</div>}
      </div>
      <button
        onClick={onDismiss}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink"
        aria-label={t('ui.toastDismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
