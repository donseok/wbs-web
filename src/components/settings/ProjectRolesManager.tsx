'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { setProjectRole, type ProjectRoleRow } from '@/app/actions/projectRoles'
import { ACCOUNT_ROLES, type AccountRole } from '@/lib/domain/accounts'

const ROLE_LABEL: Record<AccountRole, string> = { admin: '관리자', member: '멤버', viewer: '조회' }

/**
 * 프로젝트 권한 표 — 관리자 슬롯은 숨기지 않고 disabled 로 보여준다.
 * 누가 관리자인지 알아야 멤버 배정을 판단할 수 있다. 어포던스는 편의일 뿐,
 * setProjectRole 서버 액션이 항상 재검증한다.
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
  const [, startTransition] = useTransition()

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

  return (
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
          {rows.map(row => {
            const locked = !canManageAdmins && row.role === 'admin'
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
                  <select
                    className="app-input h-8 w-auto text-xs"
                    value={row.role}
                    disabled={locked || savingId === row.userId}
                    title={locked ? '관리자의 역할 변경은 슈퍼유저만 할 수 있습니다.' : undefined}
                    onChange={(e) => change(row, e.target.value as AccountRole)}
                  >
                    {ACCOUNT_ROLES.map(r => (
                      <option key={r} value={r} disabled={r === 'admin' && !canManageAdmins}>
                        {ROLE_LABEL[r]}{r === 'admin' && !canManageAdmins ? ' (슈퍼유저 전용)' : ''}
                      </option>
                    ))}
                  </select>
                  {errors[row.userId] ? (
                    <p role="alert" className="mt-1 text-xs font-medium text-delayed">{errors[row.userId]}</p>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs leading-5 text-ink-subtle">
        역할이 없는 계정은 조회 전용입니다. 관리자 지정·해제는 슈퍼유저만 할 수 있습니다.
      </p>
    </div>
  )
}
