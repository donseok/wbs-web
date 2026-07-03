import type { ComputedItem, Level, Status, TeamCode } from '@/lib/domain/types'

export const TEAM: Record<TeamCode, { fg: string; bar: string }> = {
  PMO: { fg: 'text-team-pmo', bar: 'bg-team-pmo' },
  가공: { fg: 'text-team-dt', bar: 'bg-team-dt' },
  ERP: { fg: 'text-team-erp', bar: 'bg-team-erp' },
  MES: { fg: 'text-team-mes', bar: 'bg-team-mes' },
}

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
/* act 하위의 담당자별 분리 항목(임포트 시 자동 생성) 전용 표기 — 일반 ACT 와 시각 구분 */
const SUB_ACT = { label: 'S-ACT', cls: 'bg-surface-2 text-ink-muted' }

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status]
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function LevelBadge({ level, sub = false }: { level: Level; sub?: boolean }) {
  const l = sub && level === 'activity' ? SUB_ACT : LEVEL[level]
  return <span className={`lvl-badge ${l.cls}`}>{l.label}</span>
}

export function OwnerBadges({ owners }: { owners: ComputedItem['owners'] }) {
  if (!owners.length) return <span className="text-ink-subtle">-</span>
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 overflow-hidden">
      {owners.map(o => (
        <span
          key={o.team + o.kind}
          className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold leading-none"
          title={o.kind === 'primary' ? `${o.team} 주관` : `${o.team} 지원`}
        >
          <span className={`${TEAM[o.team].fg} ${o.kind === 'support' ? 'opacity-60' : ''} text-[9px] leading-none`}>
            {o.kind === 'primary' ? '●' : '△'}
          </span>
          <span className="text-ink-muted">{o.team}</span>
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
