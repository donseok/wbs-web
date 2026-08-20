'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { setProjectRole, type ProjectRoleRow } from '@/app/actions/projectRoles'
import type { AccountRole } from '@/lib/domain/accounts'

const ROLE_LABEL: Record<AccountRole, string> = { admin: '관리자', member: '멤버', viewer: '조회' }

/**
 * 계정 검색 콤보박스 — 계정 수십 명을 네이티브 select 로는 찾을 수 없다는 피드백
 * (2026-08-20, AssigneeComboBox 가 만들어진 2026-08-11 피드백과 동일한 이유).
 * AssigneeComboBox 는 ProjectMember 타입·buildMemberPickerSections 에 묶여 있어
 * 재사용하지 않고, 같은 WAI-ARIA combobox 패턴으로 경량 구현한다.
 * 이름·이메일·팀 코드 어느 것으로든 타이핑 필터, 화살표+Enter 선택, 외부 클릭 닫힘.
 */
function AccountComboBox({ candidates, value, onChange }: {
  candidates: ProjectRoleRow[]
  value: string
  onChange: (userId: string) => void
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selected = value ? candidates.find(c => c.userId === value) ?? null : null
  const selectedLabel = selected ? `${selected.name ?? selected.email} (${selected.email})` : ''

  const options = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ko-KR')
    const all = candidates.map(c => ({
      id: c.userId,
      label: `${c.name ?? c.email} (${c.email})${c.teamCode ? ` · ${c.teamCode}` : ''}`,
      haystack: `${c.name ?? ''} ${c.email} ${c.teamCode ?? ''}`.toLocaleLowerCase('ko-KR'),
    }))
    return q ? all.filter(o => o.haystack.includes(q)) : all
  }, [candidates, query])

  useEffect(() => { setActiveIndex(0) }, [query, open])

  useEffect(() => {
    if (!open) return
    const opt = options[activeIndex]
    if (opt) document.getElementById(`${listboxId}-opt-${opt.id}`)?.scrollIntoView({ block: 'nearest' })
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
    onChange(id)
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
    <div ref={rootRef} className="relative min-w-[220px] flex-1">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
        <input
          role="combobox"
          aria-label="권한을 줄 계정"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[activeIndex] ? `${listboxId}-opt-${options[activeIndex].id}` : undefined}
          className="app-input h-8 pl-8 pr-8 text-xs"
          value={open ? query : selectedLabel}
          placeholder="이름·이메일·팀으로 검색…"
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          onBlur={e => {
            // 목록 옵션 클릭 시에도 blur 가 먼저 온다 — 포커스가 root 내부에 남으면 닫지 않는다.
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
            <li className="px-2 py-1.5 text-xs text-ink-subtle">검색 결과가 없습니다.</li>
          ) : options.map((opt, i) => (
            <li
              key={opt.id}
              id={`${listboxId}-opt-${opt.id}`}
              role="option"
              aria-selected={opt.id === value}
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

/**
 * 프로젝트 권한 표 — 역할을 받은 계정과 슈퍼유저만 나열한다. 전 계정을 '조회'로
 * 깔아두면 이 화면이 "모두가 이 프로젝트에 들어와 있다"로 읽힌다(2026-08-20 오독 사례).
 * 역할 없는 계정은 아래 추가 콤보로만 등장하고, 해제(조회)하면 표에서 빠진다.
 * 슈퍼유저는 역할 행이 없어도 전권이므로 숨기지 않는다 — 숨기면 "권한 없는데 다
 * 만지네" 혼란이 재발한다. 어포던스는 편의일 뿐, setProjectRole 이 항상 재검증한다.
 * Actor 는 Map 을 품고 있어 직렬화되지 않는다 — canManageAdmins boolean 만 내려받는다.
 */
export function ProjectRolesManager({ projectId, rows, canManageAdmins }: {
  projectId: string
  rows: ProjectRoleRow[]
  canManageAdmins: boolean
}) {
  const router = useRouter()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<AccountRole>('member')
  const [addError, setAddError] = useState('')
  const [, startTransition] = useTransition()

  const granted = rows.filter(r => r.isSuperuser || r.role !== 'viewer')
  const candidates = rows.filter(r => !r.isSuperuser && r.role === 'viewer')

  function change(row: ProjectRoleRow, role: AccountRole) {
    setErrors(prev => ({ ...prev, [row.userId]: '' }))
    setSavingId(row.userId)
    startTransition(async () => {
      try {
        const res = await setProjectRole(projectId, row.userId, role)
        if (!res.ok) {
          // 조용한 실패 금지 — 실패 사유를 그 행 아래 표시한다.
          setErrors(prev => ({ ...prev, [row.userId]: res.error ?? '변경 실패' }))
        } else {
          router.refresh()
        }
      } catch {
        setErrors(prev => ({ ...prev, [row.userId]: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }))
      } finally {
        setSavingId(null)
      }
    })
  }

  function add() {
    if (!addUserId) return
    setAddError('')
    setSavingId(addUserId)
    startTransition(async () => {
      try {
        const res = await setProjectRole(projectId, addUserId, addRole)
        if (!res.ok) {
          setAddError(res.error ?? '추가 실패')
        } else {
          setAddUserId('')
          setAddRole('member')
          router.refresh()
        }
      } catch {
        setAddError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      } finally {
        setSavingId(null)
      }
    })
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        aria-expanded={expanded}
        aria-controls="project-roles-table"
        onClick={() => setExpanded(value => !value)}
      >
        <span>{expanded ? '권한 목록 접기' : `권한 목록 펼치기 (${granted.length}명)`}</span>
        {expanded ? <ChevronUp className="h-4 w-4 text-ink-subtle" /> : <ChevronDown className="h-4 w-4 text-ink-subtle" />}
      </button>
      {expanded && (
        <div id="project-roles-table" className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">이메일</th>
                  <th className="py-2 pr-3">팀</th>
                  <th className="py-2 pr-3">역할</th>
                </tr>
              </thead>
              <tbody>
                {granted.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-ink-subtle">
                      아직 권한을 받은 계정이 없습니다. 아래에서 추가하세요.
                    </td>
                  </tr>
                )}
                {granted.map(row => {
                  const locked = !canManageAdmins && row.role === 'admin'
                  // 슈퍼유저는 역할 행 없이도 전권 — '조회' 셀렉트를 보여주면 오독을 되살린다.
                  const superuserWithoutRole = row.isSuperuser && row.role === 'viewer'
                  return (
                    <tr key={row.userId} className="border-b border-line/60 align-top">
                      <td className="py-2.5 pr-3 font-medium text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          {row.name ?? '—'}
                          {row.isSuperuser && (
                            <span className="chip bg-done-weak text-done" title="슈퍼유저 — 모든 프로젝트 관리 권한">
                              <ShieldCheck className="h-3 w-3" />SU
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-ink-muted">{row.email}</td>
                      <td className="py-2.5 pr-3">
                        {row.teamCode ? <span className="chip bg-surface-2 text-ink-muted">{row.teamCode}</span> : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {superuserWithoutRole ? (
                          <span className="text-xs text-ink-subtle" title="슈퍼유저는 프로젝트 역할 없이 항상 전권입니다.">
                            전권 (슈퍼유저)
                          </span>
                        ) : (
                          <select
                            className="app-input h-8 w-auto text-xs"
                            value={row.role}
                            disabled={locked || savingId === row.userId}
                            title={locked ? '관리자의 역할 변경은 슈퍼유저만 할 수 있습니다.' : undefined}
                            onChange={(e) => change(row, e.target.value as AccountRole)}
                          >
                            <option value="admin" disabled={!canManageAdmins}>
                              {ROLE_LABEL.admin}{!canManageAdmins ? ' (슈퍼유저 전용)' : ''}
                            </option>
                            <option value="member">{ROLE_LABEL.member}</option>
                            <option value="viewer">{ROLE_LABEL.viewer} (해제)</option>
                          </select>
                        )}
                        {errors[row.userId] ? (
                          <p role="alert" className="mt-1 text-xs font-medium text-delayed">{errors[row.userId]}</p>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <UserPlus className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
              <AccountComboBox
                candidates={candidates}
                value={addUserId}
                onChange={(userId) => { setAddUserId(userId); setAddError('') }}
              />
              <select
                className="app-input h-8 w-auto text-xs"
                value={addRole}
                aria-label="부여할 역할"
                onChange={(e) => setAddRole(e.target.value as AccountRole)}
              >
                <option value="member">{ROLE_LABEL.member}</option>
                <option value="admin" disabled={!canManageAdmins}>
                  {ROLE_LABEL.admin}{!canManageAdmins ? ' (슈퍼유저 전용)' : ''}
                </option>
              </select>
              <button
                type="button"
                className="btn btn-primary h-8 px-3 text-xs"
                disabled={!addUserId || savingId === addUserId}
                onClick={add}
              >
                추가
              </button>
            </div>
            {addError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-delayed">{addError}</p>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-ink-subtle">
            역할을 받은 계정과 슈퍼유저만 표시됩니다. 그 외 계정은 조회 전용이며 위 콤보로 권한을 부여할 수 있습니다.
            역할을 조회(해제)로 바꾸면 목록에서 빠집니다. 관리자 지정·해제는 슈퍼유저만 할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  )
}
