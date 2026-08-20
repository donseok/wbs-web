'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, ShieldCheck, UserPlus } from 'lucide-react'
import { setProjectRole, type ProjectRoleRow } from '@/app/actions/projectRoles'
import type { AccountRole } from '@/lib/domain/accounts'

const ROLE_LABEL: Record<AccountRole, string> = { admin: '관리자', member: '멤버', viewer: '조회' }

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
              <select
                className="app-input h-8 min-w-[220px] flex-1 text-xs"
                value={addUserId}
                aria-label="권한을 줄 계정"
                onChange={(e) => { setAddUserId(e.target.value); setAddError('') }}
              >
                <option value="">권한을 줄 계정 선택…</option>
                {candidates.map(c => (
                  <option key={c.userId} value={c.userId}>
                    {c.name ?? c.email} ({c.email})
                  </option>
                ))}
              </select>
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
