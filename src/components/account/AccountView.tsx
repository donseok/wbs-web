'use client'

import { useState } from 'react'
import { KeyRound, Mail, User as UserIcon } from 'lucide-react'
import { PageHero } from '@/components/ui/PageHero'
import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'
import { MyTokensSection } from '@/components/account/MyTokensSection'

/**
 * 내 계정 — 결정 D. 3구획: 프로필 정보 · 비밀번호 변경 · PAT 발급/관리.
 * HeaderChrome 드롭다운의 비밀번호 변경 진입은 이 화면으로 이동했다(ChangePasswordModal 재사용).
 */
export function AccountView({ email, displayName, projects }: {
  email: string | null
  displayName: string | null
  projects: { id: string; name: string }[]
}) {
  const [pwOpen, setPwOpen] = useState(false)

  return (
    <div className="space-y-6">
      <PageHero eyebrow="ACCOUNT" title="내 계정" />

      <div className="card p-5 sm:p-6">
        <div className="eyebrow">Profile</div>
        <h2 className="mt-0.5 text-sm font-semibold text-ink">프로필 정보</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <UserIcon className="h-4 w-4 text-ink-subtle" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">이름</div>
              <div className="truncate text-sm text-ink">{displayName ?? '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <Mail className="h-4 w-4 text-ink-subtle" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">이메일</div>
              <div className="truncate text-sm text-ink">{email ?? '—'}</div>
            </div>
          </div>
        </div>
        <button onClick={() => setPwOpen(true)} className="btn btn-ghost mt-4">
          <KeyRound className="h-4 w-4" />비밀번호 변경
        </button>
      </div>

      <MyTokensSection projects={projects} />

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  )
}
