import type { ComputedItem, Level, Status } from '@/lib/domain/types'

export const STATUS: Record<Status, { label: string; chip: string; bar: string; dot: string }> = {
  not_started: { label: '시작전', chip: 'bg-pending-weak text-pending', bar: 'bg-pending', dot: 'bg-pending' },
  in_progress: { label: '진행중', chip: 'bg-progress-weak text-progress', bar: 'bg-progress', dot: 'bg-progress' },
  delayed: { label: '지연', chip: 'bg-delayed-weak text-delayed', bar: 'bg-delayed', dot: 'bg-delayed' },
  done: { label: '완료', chip: 'bg-done-weak text-done', bar: 'bg-done', dot: 'bg-done' },
}

const LEVEL: Record<Level, { label: string; cls: string }> = {
  phase: { label: 'PHASE', cls: 'bg-brand-weak text-brand' },
  task: { label: 'TASK', cls: 'bg-progress-weak text-progress' },
  activity: { label: 'ACT', cls: 'bg-pending-weak text-pending' },
}

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status]
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function LevelBadge({ level }: { level: Level }) {
  const l = LEVEL[level]
  return <span className={`lvl-badge ${l.cls}`}>{l.label}</span>
}

export function OwnerBadges({ owners }: { owners: ComputedItem['owners'] }) {
  if (!owners.length) return <span className="text-ink-subtle">-</span>
  return (
    <div className="flex flex-wrap gap-1">
      {owners.map(o => (
        <span
          key={o.team + o.kind}
          className={
            o.kind === 'primary'
              ? 'badge bg-brand text-brand-fg'
              : 'badge border border-line bg-surface-2 text-ink-muted'
          }
          title={o.kind === 'primary' ? `${o.team} 주관` : `${o.team} 지원`}
        >
          <span className="mr-0.5 text-[8px] leading-none">{o.kind === 'primary' ? '●' : '△'}</span>
          {o.team}
        </span>
      ))}
    </div>
  )
}

export function fmtDate(d: string | null): string {
  if (!d) return '-'
  return d.slice(2).replace(/-/g, '.') // 2026-09-15 -> 26.09.15
}

export function collectLeaves(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      if (!n.children.length) out.push(n)
      walk(n.children)
    })
  walk(items)
  return out
}
