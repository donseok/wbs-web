import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** eyebrow + 타이틀 헤더가 있는 카드 컨테이너. */
export function SectionCard({
  eyebrow, title, icon: Icon, actions, children, className = '',
}: {
  eyebrow?: string
  title: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand"><Icon className="h-4 w-4" /></span>}
          <div>
            {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{eyebrow}</div>}
            <h3 className="mt-0.5 text-sm font-semibold text-ink">{title}</h3>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}
