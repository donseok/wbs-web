import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** eyebrow + 타이틀 헤더가 있는 카드 컨테이너. */
export function SectionCard({
  eyebrow, title, icon: Icon, actions, children, className = '',
  fill = false, bodyClassName = '',
}: {
  eyebrow?: string
  title: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** 그리드 행 높이를 채우고 본문이 내부 스크롤할 수 있게 한다. 기본 false — 기존 호출부 동작 불변. */
  fill?: boolean
  bodyClassName?: string
}) {
  return (
    <section className={`card p-5 sm:p-6 ${fill ? 'flex h-full min-h-0 flex-col' : ''} ${className}`}>
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand"><Icon className="h-4 w-4" /></span>}
          <div>
            {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{eyebrow}</div>}
            <h3 className="mt-0.5 text-sm font-semibold text-ink">{title}</h3>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={`mt-5 ${fill ? 'min-h-0 flex-1' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  )
}
