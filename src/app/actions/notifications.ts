'use server'

import { getComputedWbs } from '@/lib/data/wbs'
import { collectLeaves } from '@/components/wbs/shared'
import type { ComputedItem } from '@/lib/domain/types'

export type NotificationItem = {
  id: string
  type: 'delayed' | 'due_soon'
  severity: 'danger' | 'warning'
  title: string
  detail: string
}

function diffDays(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** 활성 프로젝트의 알림 피드 — 지연 작업 + 마감 임박(7일 내) 작업. */
export async function getNotifications(projectId: string): Promise<{ items: NotificationItem[]; count: number }> {
  const { items, today } = await getComputedWbs(projectId)
  const leaves = collectLeaves(items)

  const delayed: NotificationItem[] = leaves
    .filter(l => l.status === 'delayed')
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))
    .map((l: ComputedItem) => ({
      id: `delay-${l.id}`,
      type: 'delayed' as const,
      severity: 'danger' as const,
      title: l.name,
      detail: l.plannedEnd
        ? `${diffDays(l.plannedEnd, today)}일 지연 · 실적 ${l.rolledActualPct}%`
        : `실적 ${l.rolledActualPct}%`,
    }))

  const dueSoon: NotificationItem[] = leaves
    .filter(l => l.status !== 'done' && l.status !== 'delayed' && l.plannedEnd && l.plannedEnd >= today && diffDays(today, l.plannedEnd) <= 7)
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))
    .map((l: ComputedItem) => ({
      id: `due-${l.id}`,
      type: 'due_soon' as const,
      severity: 'warning' as const,
      title: l.name,
      detail: `D-${diffDays(today, l.plannedEnd!)} · ${l.plannedEnd} 마감`,
    }))

  const items_ = [...delayed, ...dueSoon].slice(0, 15)
  return { items: items_, count: items_.length }
}
