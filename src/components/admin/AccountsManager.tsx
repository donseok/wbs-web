'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Upload, KeyRound, UserCog, ShieldCheck, UserRound, Wand2, Copy, Check } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import {
  createAccount, bulkCreateAccounts, resetPassword, updateAccountRole,
  type AccountRow, type BulkResultRow,
} from '@/app/actions/accounts'
import { ACCOUNT_ROLES, type AccountRole } from '@/lib/domain/accounts'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { isValidEmail } from '@/lib/domain/validate'
import type { TeamCode } from '@/lib/domain/types'

const ROLE_LABEL: Record<string, string> = { pmo_admin: 'PMO 관리자', team_editor: '팀 편집자' }

/** 브라우저 crypto 로 임시 비밀번호(12자) 생성 — 리셋/추가 시 [생성] 버튼용. */
function randomPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => chars[n % chars.length]).join('')
}

export function AccountsManager({ accounts }: { accounts: AccountRow[] }) {
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [resetting, setResetting] = useState<AccountRow | null>(null)
  const [editing, setEditing] = useState<AccountRow | null>(null)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Account board</div>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">로그인 계정 · {accounts.length}개</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBulkOpen(true)} className="btn btn-ghost">
            <Upload className="h-4 w-4" />일괄 추가
          </button>
          <button onClick={() => setAddOpen(true)} className="btn btn-primary">
            <UserPlus className="h-4 w-4" />계정 추가
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {accounts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="계정이 없습니다"
            description="계정 추가 또는 일괄 추가로 로그인 계정을 만드세요."
            action={<button onClick={() => setAddOpen(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" />계정 추가</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3">이메일</th>
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">팀</th>
                  <th className="py-2 pr-3">권한</th>
                  <th className="py-2 pr-3">생성일</th>
                  <th className="py-2 pr-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-line/60">
                    <td className="py-2.5 pr-3 font-medium text-ink">{a.email}</td>
                    <td className="py-2.5 pr-3 text-ink-muted">{a.name ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      {a.teamCode ? <span className="chip bg-surface-2 text-ink-muted">{a.teamCode}</span> : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {a.role ? (
                        <span className={`chip ${a.role === 'pmo_admin' ? 'bg-brand-weak text-brand' : 'bg-progress-weak text-progress'}`}>
                          {a.role === 'pmo_admin' ? <ShieldCheck className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                          {ROLE_LABEL[a.role] ?? a.role}
                        </span>
                      ) : (
                        <span className="chip bg-delayed-weak text-delayed">미지정</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-subtle">{a.createdAt.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditing(a)} className="btn btn-ghost btn-sm" title="팀·권한 수정">
                          <UserCog className="h-3.5 w-3.5" />권한
                        </button>
                        <button onClick={() => setResetting(a)} className="btn btn-ghost btn-sm" title="비밀번호 리셋">
                          <KeyRound className="h-3.5 w-3.5" />비번 리셋
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
      <BulkAddModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <ResetPasswordModal account={resetting} onClose={() => setResetting(null)} />
      <RoleEditModal account={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function AddAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { toast } = useToast()
  const teamOptions = useTeamCodes()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [teamCode, setTeamCode] = useState<TeamCode>(teamOptions[0] ?? 'PMO')
  const [role, setRole] = useState<AccountRole>('team_editor')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setEmail(''); setName(''); setTeamCode(teamOptions[0] ?? 'PMO'); setRole('team_editor'); setPassword(''); setError(null)
  }, [open, teamOptions])

  function submit() {
    setError(null)
    if (!isValidEmail(email)) { setError('올바른 이메일을 입력하세요.'); return }
    if (password.length < 8) { setError('초기 비밀번호는 8자 이상이어야 합니다.'); return }
    startTransition(async () => {
      try {
        const res = await createAccount({ email: email.trim(), password, teamCode, role, name: name.trim() || null })
        if (res.ok) {
          toast({ title: '계정을 만들었습니다.', description: email.trim(), variant: 'success' })
          onClose(); router.refresh()
        } else {
          setError(res.error ?? '생성 실패')
        }
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="New account" title="계정 추가"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '생성 중…' : '계정 만들기'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="이메일 (로그인 아이디)">
          <input className="app-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" autoFocus />
        </Field>
        <Field label="이름 (선택)">
          <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="팀">
            <select className="app-input" value={teamCode} onChange={(e) => setTeamCode(e.target.value as TeamCode)}>
              {teamOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="권한">
            <select className="app-input" value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
              {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="초기 비밀번호 (8자 이상)">
          <div className="flex gap-2">
            <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="초기 비밀번호" />
            <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />생성</button>
          </div>
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}

function BulkAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [results, setResults] = useState<BulkResultRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setText(''); setResults(null); setError(null)
  }, [open])

  function submit() {
    setError(null); setResults(null)
    startTransition(async () => {
      try {
        const res = await bulkCreateAccounts(text)
        if (!res.ok) { setError(res.error ?? '처리 실패'); return }
        setResults(res.results)
        router.refresh() // 성공분을 목록에 반영
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="Bulk create" title="일괄 추가" size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>닫기</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending || !text.trim()}>{pending ? '처리 중…' : '일괄 생성'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-xs leading-5 text-ink-muted">
          한 줄에 하나씩, <b>이메일, 팀코드, 권한, 초기비번</b> 순서(선택: 이름). 콤마 또는 탭 구분.<br />
          팀코드: <code>PMO · 가공 · ERP · MES · MDM</code> / 권한: <code>pmo_admin · team_editor</code><br />
          예) <code>hong@company.com, 가공, team_editor, password1, 홍길동</code>
        </div>
        <textarea
          className="app-input min-h-[160px] font-mono text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'user1@company.com, PMO, team_editor, password1\nuser2@company.com, 가공, team_editor, password2, 김철수'}
        />
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
        {results && (
          <div>
            <div className="mb-2 text-sm font-semibold text-ink">결과 — 성공 {okCount} · 실패 {failCount}</div>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-xs">
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-1.5 text-ink-subtle">{r.lineNo}행</td>
                      <td className="px-3 py-1.5 text-ink">{r.email}</td>
                      <td className="px-3 py-1.5">
                        {r.ok
                          ? <span className="chip bg-done-weak text-done">성공</span>
                          : <span className="chip bg-delayed-weak text-delayed" title={r.error}>실패</span>}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">{r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ResetPasswordModal({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [done, setDone] = useState<string | null>(null) // 적용 완료된 임시 비밀번호 — 전달용으로 유지
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (account) { setPassword(randomPassword()); setDone(null); setCopied(false); setError(null) }
  }, [account])

  function submit() {
    setError(null)
    if (!account) return
    if (password.length < 8) { setError('임시 비밀번호는 8자 이상이어야 합니다.'); return }
    startTransition(async () => {
      try {
        const res = await resetPassword(account.id, password)
        if (res.ok) {
          setDone(password) // 모달을 닫지 않고 값을 유지 — 전달 전 소실 방지
          toast({ title: '비밀번호를 리셋했습니다.', variant: 'success' })
        } else {
          setError(res.error ?? '리셋 실패')
        }
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  async function copy() {
    if (!done) return
    try { await navigator.clipboard.writeText(done); setCopied(true) } catch { /* 클립보드 미지원 시 무시 */ }
  }

  return (
    <Modal
      open={!!account} onClose={onClose} eyebrow="Reset password" title="비밀번호 리셋"
      footer={
        done ? (
          <button onClick={onClose} className="btn btn-primary">닫기</button>
        ) : (
          <>
            <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
            <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '적용 중…' : '리셋'}</button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {done ? (
          <>
            <p className="text-sm text-ink-muted"><b className="text-ink">{account?.email}</b> 의 임시 비밀번호가 설정되었습니다. 아래 값을 사용자에게 전달하세요. <b className="text-ink">이 창을 닫으면 다시 볼 수 없습니다.</b></p>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{done}</code>
              <button type="button" onClick={copy} className="btn btn-ghost btn-sm shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '복사됨' : '복사'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted"><b className="text-ink">{account?.email}</b> 의 비밀번호를 임시값으로 변경합니다. 사용자는 로그인 후 본인이 변경하게 하세요.</p>
            <Field label="임시 비밀번호 (8자 이상)">
              <div className="flex gap-2">
                <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />생성</button>
              </div>
            </Field>
            {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

function RoleEditModal({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const router = useRouter()
  const { toast } = useToast()
  const teamOptions = useTeamCodes()
  const [teamCode, setTeamCode] = useState<TeamCode>(teamOptions[0] ?? 'PMO')
  const [role, setRole] = useState<AccountRole>('team_editor')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!account) return
    setTeamCode((account.teamCode as TeamCode) ?? teamOptions[0] ?? 'PMO')
    setRole((account.role as AccountRole) === 'pmo_admin' ? 'pmo_admin' : 'team_editor')
    setError(null)
  }, [account, teamOptions])

  function submit() {
    setError(null)
    if (!account) return
    startTransition(async () => {
      try {
        const res = await updateAccountRole(account.id, teamCode, role)
        if (res.ok) {
          toast({ title: '팀·권한을 변경했습니다.', variant: 'success' })
          onClose(); router.refresh()
        } else {
          setError(res.error ?? '변경 실패')
        }
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  return (
    <Modal
      open={!!account} onClose={onClose} eyebrow="Team & role" title="팀·권한 수정"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '저장 중…' : '저장'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted"><b className="text-ink">{account?.email}</b></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="팀">
            <select className="app-input" value={teamCode} onChange={(e) => setTeamCode(e.target.value as TeamCode)}>
              {teamOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="권한">
            <select className="app-input" value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
              {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}
