'use client'

import type { LucideIcon } from 'lucide-react'

export type SegTab<T extends string = string> = { key: T; label: string; icon?: LucideIcon }

/** 세그먼트 토글 — 칸반 그룹/뷰 전환, 근태 캘린더/리스트 등. */
export function SegmentedTabs<T extends string>({
  tabs, value, onChange, size = 'md',
}: {
  tabs: SegTab<T>[]
  value: T
  onChange: (key: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm'
  return (
    <div className="seg" role="tablist">
      {tabs.map(tab => {
        const active = tab.key === value
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition duration-150 ${pad} ${active ? 'seg-item-active' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
