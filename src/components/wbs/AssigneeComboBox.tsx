'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { ProjectMember, TeamCode } from '@/lib/domain/types'
import { buildMemberPickerSections } from '@/lib/domain/memberPicker'

type Option = { id: string; label: string }

/**
 * 담당자 검색 콤보박스 — 멤버 52명+ 프로젝트에서 네이티브 select 로는 찾기 어렵다는
 * 스테이징 실사용 피드백(2026-08-11). 타이핑으로 이름·팀 필터, 화살표+Enter 선택,
 * 외부 클릭 시 닫힘.
 *
 * 리포에 기존 "단일 선택" 검색 콤보박스 관례는 없다(조사 결과 — ProjectMemberMultiPicker 는
 * 체크박스 기반 멀티선택 전용이라 재사용 불가). 필터 로직(buildMemberPickerSections)만
 * 재사용하고, WAI-ARIA combobox 패턴(role=combobox/listbox/option)으로 경량 자체 구현한다.
 * G2 제약(src/components/wbs/* 안에서만) 준수 — 상태 변형 display 유틸 없음.
 */
export function AssigneeComboBox({
  members, value, onChange, disabled, categoryOrder, unassignedLabel, placeholder, noResultsLabel, ariaLabelledBy,
}: {
  members: readonly ProjectMember[]
  value: string | null
  onChange: (memberId: string | null) => void
  disabled?: boolean
  categoryOrder: readonly TeamCode[]
  unassignedLabel: string
  placeholder: string
  noResultsLabel: string
  /** 시각적 라벨(<span id=...>)과 연결 — 호출부가 <label> 로 감싸지 않으므로 여기로만 연결한다. */
  ariaLabelledBy?: string
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selectedMember = value ? members.find(m => m.id === value) ?? null : null
  const selectedLabel = selectedMember
    ? `${selectedMember.name}${selectedMember.teamCode ? ` · ${selectedMember.teamCode}` : ''}`
    : unassignedLabel

  const options: Option[] = useMemo(() => {
    const sections = buildMemberPickerSections(members, { query, view: 'name', categoryOrder })
    const memberOptions = (sections[0]?.members ?? []).map(m => ({
      id: m.id, label: `${m.name}${m.teamCode ? ` · ${m.teamCode}` : ''}`,
    }))
    const q = query.trim().toLocaleLowerCase('ko-KR')
    const showUnassigned = !q || unassignedLabel.toLocaleLowerCase('ko-KR').includes(q)
    return showUnassigned ? [{ id: '', label: unassignedLabel }, ...memberOptions] : memberOptions
  }, [members, query, categoryOrder, unassignedLabel])

  useEffect(() => { setActiveIndex(0) }, [query, open])

  // 옵션 7개+ 목록에서 화살표로 하이라이트를 옮기면 스크롤 밖으로 나갈 수 있다 —
  // 하이라이트가 바뀔 때마다 해당 option을 목록 안으로 스크롤한다(리뷰 라운드 1).
  useEffect(() => {
    if (!open) return
    const opt = options[activeIndex]
    if (!opt) return
    const elId = `${listboxId}-opt-${opt.id || 'unassigned'}`
    document.getElementById(elId)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, options, listboxId])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function commit(id: string) {
    onChange(id === '' ? null : id)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setOpen(true) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options[activeIndex]
      if (opt) commit(opt.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
        <input
          role="combobox"
          aria-labelledby={ariaLabelledBy}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[activeIndex] ? `${listboxId}-opt-${options[activeIndex].id || 'unassigned'}` : undefined}
          className="app-input h-9 pl-8 pr-8 text-xs"
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          onBlur={e => {
            // 마우스로 목록의 옵션을 클릭할 때도 blur 가 먼저 발생한다 — relatedTarget/포인터
            // 이동 시점에 root 내부(목록)로 포커스가 남아있으면 닫지 않는다. Tab 등으로
            // 완전히 벗어나는 경우에만 닫는다(외부 클릭 close는 별도의 mousedown 리스너가 담당).
            if (rootRef.current && e.relatedTarget && rootRef.current.contains(e.relatedTarget as Node)) return
            setOpen(false)
            setQuery('')
          }}
        />
        <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
      </div>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-ink-subtle">{noResultsLabel}</li>
          ) : options.map((opt, i) => (
            <li
              key={opt.id || 'unassigned'}
              id={`${listboxId}-opt-${opt.id || 'unassigned'}`}
              role="option"
              aria-selected={opt.id === (value ?? '')}
              onMouseDown={e => { e.preventDefault(); commit(opt.id) }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-xs ${i === activeIndex ? 'bg-brand-weak text-brand' : 'text-ink'}`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
