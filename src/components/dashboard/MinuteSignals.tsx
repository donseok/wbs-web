import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock3 } from 'lucide-react'
import type { InsightKind, MinuteInsight } from '@/lib/domain/types'
import { SectionCard } from '@/components/ui/SectionCard'

const META: Record<InsightKind, { label: string; cls: string; Icon: typeof AlertTriangle }> = {
  risk: { label: '리스크', cls: 'bg-delayed-weak text-delayed', Icon: AlertTriangle },
  action: { label: '액션', cls: 'bg-progress-weak text-progress', Icon: ClipboardList },
  decision: { label: '결정', cls: 'bg-done-weak text-done', Icon: CheckCircle2 },
  deadline: { label: '기한', cls: 'bg-accent-warning/15 text-accent-warning', Icon: Clock3 },
}

export interface MinuteSignal extends MinuteInsight {
  minuteTitle: string
  minuteDate: string
}

export function MinuteSignals({ signals }: { projectId: string; signals: MinuteSignal[] }) {
  return (
    <SectionCard eyebrow="MINUTE SIGNALS" title="주요 이슈·의사결정" icon={AlertTriangle}
      actions={<span className="chip bg-brand-weak text-brand">최근 {signals.length}건</span>}>
      {signals.length === 0 ? <p className="text-sm text-ink-muted">연결된 회의록 인사이트가 없습니다.</p> : (
        <div className="space-y-2">
          {signals.map(s => {
            if (s.kind === 'none') return null
            const meta = META[s.kind]
            const Icon = meta.Icon
            return <div key={s.id} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`chip ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[11px] text-ink-subtle">{s.minuteDate} · {s.minuteTitle}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{s.label}</p>
              </div>
              <Link href={`/minutes/${s.minuteId}`} className="shrink-0 text-brand" title="회의록 열기">
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          })}
        </div>
      )}
      <Link href="/minutes" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        회의록 전체 보기 <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </SectionCard>
  )
}
