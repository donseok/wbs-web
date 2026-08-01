'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  buildMemberPickerSections,
  type MemberPickerView,
} from '@/lib/domain/memberPicker'
import type { ProjectMember, TeamCode } from '@/lib/domain/types'

export function MemberPickerViewToggle({
  value,
  onChange,
  compact = false,
}: {
  value: MemberPickerView
  onChange: (view: MemberPickerView) => void
  compact?: boolean
}) {
  const { t } = useLocale()
  const options: { value: MemberPickerView; label: string }[] = [
    { value: 'name', label: t('ui.memberPicker.nameOrder') },
    { value: 'category', label: t('ui.memberPicker.categoryOrder') },
  ]

  return (
    <div
      role="group"
      aria-label={t('ui.memberPicker.viewLabel')}
      className="inline-flex shrink-0 rounded-lg border border-line bg-surface p-0.5"
    >
      {options.map(option => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`${compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'} rounded-md font-medium transition ${
              active
                ? 'bg-brand-weak text-brand shadow-sm'
                : 'text-ink-subtle hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function categoryLabel(category: TeamCode | null, unassignedLabel: string): string {
  return category ?? unassignedLabel
}

export function MemberSelectOptions({
  members,
  view,
  categoryOrder,
}: {
  members: readonly ProjectMember[]
  view: MemberPickerView
  categoryOrder: readonly TeamCode[]
}) {
  const { t } = useLocale()
  const sections = buildMemberPickerSections(members, { view, categoryOrder })
  const option = (member: ProjectMember) => (
    <option key={member.id} value={member.id}>
      {member.name}{member.teamCode ? ` · ${member.teamCode}` : ''}
    </option>
  )

  if (view === 'name') return <>{sections[0]?.members.map(option)}</>

  return (
    <>
      {sections.map(section => section.kind === 'category' && (
        <optgroup
          key={`category:${section.category ?? ''}`}
          label={`${categoryLabel(section.category, t('ui.memberPicker.unassigned'))} (${section.members.length})`}
        >
          {section.members.map(option)}
        </optgroup>
      ))}
    </>
  )
}

export function ProjectMemberMultiPicker({
  members,
  selected,
  onChange,
  searchPlaceholder,
  selectedSuffix,
  missingEmailWarning,
}: {
  members: ProjectMember[]
  selected: string[]
  onChange: (ids: string[]) => void
  searchPlaceholder: string
  selectedSuffix: string
  /** 지정하면 이메일이 없는 사람에게 회의 안내 경고를 표시한다. */
  missingEmailWarning?: string
}) {
  const { t } = useLocale()
  const categoryOrder = useTeamCodes()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<MemberPickerView>('name')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const sections = useMemo(
    () => buildMemberPickerSections(members, { query, view, categoryOrder }),
    [members, query, view, categoryOrder],
  )
  const visibleCount = sections.reduce((count, section) => count + section.members.length, 0)

  const toggle = (id: string) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  const memberRow = (member: ProjectMember) => {
    const checked = selectedSet.has(member.id)
    return (
      <label
        key={member.id}
        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-surface-2 ${checked ? 'bg-brand-weak/40' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggle(member.id)}
          className="h-4 w-4 accent-[var(--color-brand)]"
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-sm text-ink">{member.name}</span>
          {member.teamCode && <span className="shrink-0 text-[11px] text-ink-subtle">· {member.teamCode}</span>}
        </span>
        {missingEmailWarning && !member.email && (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-delayed"
            title={missingEmailWarning}
          >
            <AlertCircle className="h-3 w-3" />
          </span>
        )}
      </label>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <span className="shrink-0 text-[11px] font-medium text-ink-subtle">
          {selected.length}{selectedSuffix}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2/40 px-3 py-1.5">
        <span className="text-[11px] font-medium text-ink-subtle">{t('ui.memberPicker.viewLabel')}</span>
        <MemberPickerViewToggle value={view} onChange={setView} compact />
      </div>
      <div className="max-h-52 overflow-y-auto p-1.5">
        {visibleCount === 0 && (
          <div className="px-2 py-6 text-center text-xs text-ink-subtle">—</div>
        )}
        {sections.map((section, index) => (
          <div key={section.kind === 'all' ? `all-${index}` : `category:${section.category ?? ''}`}>
            {section.kind === 'category' && (
              <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-2 py-1.5 text-[11px] font-semibold text-ink-muted">
                <span>{categoryLabel(section.category, t('ui.memberPicker.unassigned'))}</span>
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 tabular-nums text-ink-subtle">
                  {section.members.length}
                </span>
              </div>
            )}
            {section.members.map(memberRow)}
          </div>
        ))}
      </div>
    </div>
  )
}
