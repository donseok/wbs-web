import { Icon, type IconName } from '@/components/ui/Icon'

const TONES = {
  brand: 'bg-brand-weak text-brand',
  success: 'bg-done-weak text-done',
  danger: 'bg-delayed-weak text-delayed',
  neutral: 'bg-surface-2 text-ink-muted',
}

export function Kpi({ label, value, sub, icon, tone = 'brand' }: { label: string; value: string; sub?: string; icon: IconName; tone?: keyof typeof TONES }) {
  return (
    <div className="card flex min-h-32 flex-col justify-between p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold text-ink-muted">{label}</div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${TONES[tone]}`}><Icon name={icon} className="h-4 w-4" /></span>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <div className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.035em] text-ink">{value}</div>
        {sub && <div className="pb-0.5 text-xs font-medium text-ink-subtle">{sub}</div>}
      </div>
    </div>
  )
}
