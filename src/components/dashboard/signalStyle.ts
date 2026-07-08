import { CheckCircle2, AlertTriangle, AlertOctagon, MinusCircle, type LucideIcon } from 'lucide-react'
import type { Signal } from '@/lib/domain/dashboard'

/** 신호 → 토큰(라이트/다크 자동 대응, 기존 상태 팔레트 재사용) + 접근성 아이콘. */
export const SIGNAL_META: Record<Signal, { text: string; dot: string; borderTop: string; chip: string; icon: LucideIcon }> = {
  green:   { text: 'text-done',           dot: 'bg-done',           borderTop: 'border-t-done',           chip: 'bg-done-weak text-done',              icon: CheckCircle2 },
  amber:   { text: 'text-accent-warning', dot: 'bg-accent-warning', borderTop: 'border-t-accent-warning', chip: 'bg-pending-weak text-accent-warning', icon: AlertTriangle },
  red:     { text: 'text-delayed',        dot: 'bg-delayed',        borderTop: 'border-t-delayed',        chip: 'bg-delayed-weak text-delayed',        icon: AlertOctagon },
  neutral: { text: 'text-ink-subtle',     dot: 'bg-ink-subtle',     borderTop: 'border-t-line-strong',    chip: 'bg-surface-2 text-ink-subtle',        icon: MinusCircle },
}
