'use client'

import { useMemo, useState } from 'react'
import { Search, AlertCircle } from 'lucide-react'
import type { ProjectMember } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'

export function MeetingAttendeePicker({
  members, selected, onChange,
}: {
  members: ProjectMember[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useLocale()
  const [q, setQ] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return members
    return members.filter(m =>
      m.name.toLowerCase().includes(kw) || (m.teamCode ?? '').toLowerCase().includes(kw))
  }, [members, q])

  const toggle = (id: string) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange([...next])
  }

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('meet.attendeeSearch')}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <span className="shrink-0 text-[11px] font-medium text-ink-subtle">{selected.length}{t('meet.attendeeSelected')}</span>
      </div>
      <div className="max-h-52 overflow-y-auto p-1.5">
        {filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-ink-subtle">—</div>
        )}
        {filtered.map(m => {
          const checked = selectedSet.has(m.id)
          return (
            <label key={m.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-surface-2 ${checked ? 'bg-brand-weak/40' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} className="h-4 w-4 accent-[var(--color-brand)]" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-sm text-ink">{m.name}</span>
                {m.teamCode && <span className="shrink-0 text-[11px] text-ink-subtle">· {m.teamCode}</span>}
              </span>
              {!m.email && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-delayed" title={t('meet.form.noEmailWarn')}>
                  <AlertCircle className="h-3 w-3" />
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
