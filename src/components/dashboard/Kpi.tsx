export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute inset-y-0 left-0 w-1 bg-brand/70" />
      <div className="pl-2">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
        <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-ink-subtle">{sub}</div>}
      </div>
    </div>
  )
}
