'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Pencil, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { setProjectRole, type ProjectRoleRow } from '@/app/actions/projectRoles'
import { updateMember, removeMember } from '@/app/actions/members'
import type { AccountRole } from '@/lib/domain/accounts'
import type { ProjectMemberRole, TeamCode } from '@/lib/domain/types'

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
    // 후보는 호출부 필터가 userId 보유를 보장하지만 타입은 nullable — 방어적으로 거른다.
    const all = candidates.filter(c => c.userId).map(c => ({
      id: c.userId as string,
      label: `${c.name ?? c.email} (${c.email})${c.orgTeamCode ? ` · ${c.orgTeamCode}` : ''}`,
      haystack: `${c.name ?? ''} ${c.email ?? ''} ${c.orgTeamCode ?? ''}`.toLocaleLowerCase('ko-KR'),
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
  // 카드 보드가 사라진 뒤(2026-08-20)엔 이 표가 페이지 본체라 기본 펼침.
  const [expanded, setExpanded] = useState(true)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<AccountRole>('member')
  const [addError, setAddError] = useState('')
  const [rosterWarning, setRosterWarning] = useState('')
  const [editing, setEditing] = useState<ProjectRoleRow | null>(null)
  const [view, setView] = useState<'list' | 'card'>('list')
  const [, startTransition] = useTransition()

  // 표시 대상: 역할 보유자 + 슈퍼유저 + 명단 등재자(계정 없는 legacy 포함 — 여기가 유일한 노출처).
  const granted = [...rows.filter(r => r.isSuperuser || r.role !== 'viewer' || r.memberId != null)]
    .sort((a, b) => {
      const w = (r: ProjectRoleRow) =>
        r.isSuperuser && r.role === 'viewer' ? 4
        : r.role === 'admin' ? 0
        : r.role === 'member' ? 1
        : r.userId ? 2 : 3
      return w(a) - w(b) || (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '', 'ko-KR')
    })
  const candidates = rows.filter(r => r.userId && !r.isSuperuser && r.role === 'viewer' && r.memberId == null)

  function change(row: ProjectRoleRow, role: AccountRole) {
    const userId = row.userId
    if (!userId) return // '계정 없음' 행은 셀렉트 자체가 없다 — 타입 방어
    setErrors(prev => ({ ...prev, [userId]: '' }))
    setSavingId(userId)
    startTransition(async () => {
      try {
        const res = await setProjectRole(projectId, userId, role)
        if (!res.ok) {
          // 조용한 실패 금지 — 실패 사유를 그 행 아래 표시한다.
          setErrors(prev => ({ ...prev, [userId]: res.error ?? '변경 실패' }))
        } else {
          // 역할 변경도 명단 동기화를 수반한다 — 동기화만 실패하면 그 행에 드러낸다.
          if (res.rosterError) {
            setErrors(prev => ({ ...prev, [userId]: '권한은 변경됐지만 명단 동기화는 실패했습니다: ' + res.rosterError }))
          }
          router.refresh()
        }
      } catch {
        setErrors(prev => ({ ...prev, [userId]: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }))
      } finally {
        setSavingId(null)
      }
    })
  }

  function add() {
    if (!addUserId) return
    setAddError('')
    setRosterWarning('')
    setSavingId(addUserId)
    startTransition(async () => {
      try {
        const res = await setProjectRole(projectId, addUserId, addRole)
        if (!res.ok) {
          setAddError(res.error ?? '추가 실패')
        } else {
          // 권한은 부여됐지만 명단 추가만 실패한 경우 — 조용히 넘기지 않는다.
          if (res.rosterError) setRosterWarning(res.rosterError)
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

  // 권한 셀 — 리스트·카드 두 뷰가 같은 컨트롤을 공유한다(분기 로직이 갈라지면 한쪽만 고치게 된다).
  function roleControl(row: ProjectRoleRow, rowKey: string) {
    const locked = !canManageAdmins && row.role === 'admin'
    // 슈퍼유저는 역할 행 없이도 전권 — '조회' 셀렉트를 보여주면 오독을 되살린다.
    if (row.isSuperuser && row.role === 'viewer') {
      return (
        <span className="text-xs text-ink-subtle" title="슈퍼유저는 프로젝트 역할 없이 항상 전권입니다.">
          전권 (슈퍼유저)
        </span>
      )
    }
    if (!row.userId) {
      return (
        <span className="text-xs text-accent-warning" title="로그인 계정이 없는 명단 행 — 계정을 만들면 자동 연결됩니다.">
          계정 없음
        </span>
      )
    }
    return (
      <>
        <select
          className="app-input h-8 w-auto text-xs"
          value={row.role}
          disabled={locked || savingId === rowKey}
          title={locked ? '관리자의 역할 변경은 슈퍼유저만 할 수 있습니다.' : undefined}
          onChange={(e) => change(row, e.target.value as AccountRole)}
        >
          <option value="admin" disabled={!canManageAdmins}>
            {ROLE_LABEL.admin}{!canManageAdmins ? ' (슈퍼유저 전용)' : ''}
          </option>
          <option value="member">{ROLE_LABEL.member}</option>
          <option value="viewer">{ROLE_LABEL.viewer} (해제)</option>
        </select>
        {errors[rowKey] ? (
          <p role="alert" className="mt-1 text-xs font-medium text-delayed">{errors[rowKey]}</p>
        ) : null}
      </>
    )
  }

  function editButton(row: ProjectRoleRow) {
    if (!row.memberId) return null
    return (
      <button
        type="button"
        aria-label={`${row.name ?? row.email ?? '참여자'} 명단 정보 수정`}
        title="프로젝트 팀·명단 구분·직함 수정"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-subtle transition hover:border-line-strong hover:text-ink"
        onClick={() => setEditing(row)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    )
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
          <div className="flex justify-end" role="group" aria-label="보기 방식">
            {(['list', 'card'] as const).map(v => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`h-7 px-2.5 text-xs font-medium transition first:rounded-l-lg last:rounded-r-lg border border-line ${
                  view === v ? 'bg-surface-2 text-ink' : 'bg-surface text-ink-subtle hover:text-ink'
                } ${v === 'card' ? '-ml-px' : ''}`}
              >
                {v === 'list' ? '리스트' : '카드'}
              </button>
            ))}
          </div>
          {view === 'list' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">이메일</th>
                  <th className="py-2 pr-3">프로젝트 팀</th>
                  <th className="py-2 pr-3">명단 구분</th>
                  <th className="py-2 pr-3">직함 / 역할</th>
                  <th className="py-2 pr-3">권한</th>
                  <th className="py-2 pr-1" aria-label="편집" />
                </tr>
              </thead>
              <tbody>
                {granted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-ink-subtle">
                      아직 참여자가 없습니다. 아래에서 계정을 검색해 추가하세요.
                    </td>
                  </tr>
                )}
                {granted.map(row => {
                  const rowKey = row.userId ?? row.memberId ?? row.email ?? ''
                  return (
                    <tr key={rowKey} className="border-b border-line/60 align-top">
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
                      <td className="py-2.5 pr-3 text-ink-muted">{row.email ?? '—'}</td>
                      <td className="py-2.5 pr-3">
                        {row.teamCode
                          ? <span className="chip bg-surface-2 text-ink-muted">{row.teamCode}</span>
                          : row.orgTeamCode
                            ? <span className="text-xs text-ink-subtle" title="프로젝트 팀 미지정 — 실제 소속팀 표시">({row.orgTeamCode})</span>
                            : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-ink-muted">
                        {row.memberId ? (row.rosterRole === 'admin' ? '리더' : '실무') : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-ink-muted">
                        {row.title ?? '—'}{row.roleLabel ? ` · ${row.roleLabel}` : ''}
                      </td>
                      <td className="py-2.5 pr-3">{roleControl(row, rowKey)}</td>
                      <td className="py-2.5 pr-1 text-right">{editButton(row)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}
          {view === 'card' && (
            granted.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-subtle">
                아직 참여자가 없습니다. 아래에서 계정을 검색해 추가하세요.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {granted.map(row => {
                  const rowKey = row.userId ?? row.memberId ?? row.email ?? ''
                  return (
                    <li key={rowKey} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            <span className="truncate">{row.name ?? '—'}</span>
                            {row.isSuperuser && (
                              <span className="chip shrink-0 bg-done-weak text-done" title="슈퍼유저 — 모든 프로젝트 관리 권한">
                                <ShieldCheck className="h-3 w-3" />SU
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-ink-muted" title={row.email ?? undefined}>
                            {row.email ?? '—'}
                          </div>
                        </div>
                        {editButton(row)}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                        {row.teamCode
                          ? <span className="chip bg-surface-2 text-ink-muted">{row.teamCode}</span>
                          : row.orgTeamCode
                            ? <span title="프로젝트 팀 미지정 — 실제 소속팀 표시">({row.orgTeamCode})</span>
                            : null}
                        {row.memberId && <span className="chip bg-progress-weak text-progress">{row.rosterRole === 'admin' ? '리더' : '실무'}</span>}
                        {row.title && <span className="truncate">{row.title}</span>}
                        {row.roleLabel && <span className="chip bg-brand-weak text-brand">{row.roleLabel}</span>}
                      </div>
                      <div className="mt-auto border-t border-line pt-3">{roleControl(row, rowKey)}</div>
                    </li>
                  )
                })}
              </ul>
            )
          )}
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
            <p className="mt-2 text-xs text-ink-subtle">
              권한을 받은 계정은 팀 구성 명단에도 자동으로 추가됩니다.
            </p>
            {addError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-delayed">{addError}</p>
            ) : null}
            {rosterWarning ? (
              <p role="alert" className="mt-2 text-xs font-medium text-delayed">
                권한은 부여됐지만 명단 추가는 실패했습니다: {rosterWarning}
              </p>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-ink-subtle">
            역할 보유자·명단 등재자·슈퍼유저가 표시됩니다. 그 외 계정은 조회 전용이며 위 콤보로 권한을 부여할 수 있습니다.
            권한을 조회(해제)로 바꾸면 권한이 삭제되고, 명단 정보(프로젝트 팀·구분·직함)는 연필 버튼으로 수정합니다.
            관리자 지정·해제는 슈퍼유저만 할 수 있습니다.
          </p>
          <RosterEditModal
            row={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); router.refresh() }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 명단 필드(프로젝트 팀·명단 구분·직함·역할 설명) 인라인 편집 — 카드 보드가 사라진 뒤
 * 이 표가 유일한 편집 입구다(2026-08-20). 이름·이메일은 계정·이메일 정본(0070)에
 * 묶여 있어 여기서 바꾸지 않는다. 삭제는 두 번 클릭(오클릭 방지, 모달 중첩 회피).
 */
function RosterEditModal({ row, onClose, onSaved }: {
  row: ProjectRoleRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const teamCodes = useTeamCodes()
  const [teamCode, setTeamCode] = useState<TeamCode | ''>('')
  const [rosterRole, setRosterRole] = useState<ProjectMemberRole>('contributor')
  const [title, setTitle] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!row) return
    setTeamCode((row.teamCode as TeamCode | null) ?? '')
    setRosterRole(row.rosterRole ?? 'contributor')
    setTitle(row.title ?? '')
    setRoleLabel(row.roleLabel ?? '')
    setError('')
    setConfirmDelete(false)
  }, [row])

  if (!row?.memberId) return null
  const memberId = row.memberId

  function save() {
    setError('')
    startTransition(async () => {
      const res = await updateMember(memberId, {
        name: row?.name ?? '',
        email: row?.email ?? null,
        teamCode: teamCode || null,
        role: rosterRole,
        title: title.trim() || null,
        roleLabel: roleLabel.trim() || null,
      })
      if (res.ok) onSaved()
      else setError(res.error ?? '저장에 실패했습니다.')
    })
  }

  function del() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setError('')
    startTransition(async () => {
      const res = await removeMember(memberId)
      if (res.ok) onSaved()
      else setError(res.error ?? '삭제에 실패했습니다.')
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Roster"
      title={`${row.name ?? row.email ?? '참여자'} — 명단 정보`}
      footer={
        <>
          <button
            type="button"
            onClick={del}
            disabled={pending}
            className={`btn btn-ghost mr-auto ${confirmDelete ? 'text-delayed' : ''}`}
            title="명단에서 제거합니다. 근태·회의 참석 기록도 함께 삭제됩니다."
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? '정말 삭제 (한 번 더)' : '명단에서 삭제'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button type="button" onClick={save} className="btn btn-primary" disabled={pending}>
            {pending ? '저장 중…' : '변경 저장'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">프로젝트 팀</span>
            <select className="app-input" value={teamCode} onChange={e => setTeamCode(e.target.value as TeamCode | '')}>
              <option value="">소속 없음</option>
              {teamCodes.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">명단 구분</span>
            <select className="app-input" value={rosterRole} onChange={e => setRosterRole(e.target.value as ProjectMemberRole)}>
              <option value="admin">리더</option>
              <option value="contributor">실무</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">직함 / 역할 설명</span>
          <input className="app-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: PM / 프로젝트 총괄" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">역할</span>
          <input className="app-input" value={roleLabel} onChange={e => setRoleLabel(e.target.value)} placeholder="예: 개발 / QA" />
        </label>
        {error ? <p role="alert" className="text-xs font-medium text-delayed">{error}</p> : null}
      </div>
    </Modal>
  )
}
