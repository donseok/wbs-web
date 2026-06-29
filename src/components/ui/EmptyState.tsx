import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="card flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-weak text-brand"><Icon className="h-5 w-5" /></span>}
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-6 text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
