'use client'

import { useEffect, useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * 로그인한 본인의 비밀번호 변경. 현재 비밀번호 재확인(signInWithPassword) 후
 * updateUser 로 변경한다. 이메일은 현재 세션에서 조회하므로 별도 prop 불필요.
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setCurrent(''); setNext(''); setConfirm(''); setError(null)
  }, [open])

  function submit() {
    setError(null)
    if (next.length < 8) { setError('새 비밀번호는 8자 이상이어야 합니다.'); return }
    if (next !== confirm) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    startTransition(async () => {
      const sb = createBrowserClient()
      const { data } = await sb.auth.getUser()
      const email = data.user?.email
      if (!email) { setError('세션을 확인할 수 없습니다. 다시 로그인해 주세요.'); return }
      // 현재 비밀번호 재확인(같은 사용자 재로그인 — 세션 유지)
      const { error: reauth } = await sb.auth.signInWithPassword({ email, password: current })
      if (reauth) { setError('현재 비밀번호가 올바르지 않습니다.'); return }
      const { error: updErr } = await sb.auth.updateUser({ password: next })
      if (updErr) { setError(updErr.message); return }
      toast({ title: '비밀번호가 변경되었습니다.', variant: 'success' })
      onClose()
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="Security" title="비밀번호 변경"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '변경 중…' : '변경'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">현재 비밀번호</span>
          <input className="app-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">새 비밀번호 (8자 이상)</span>
          <input className="app-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">새 비밀번호 확인</span>
          <input className="app-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p role="alert" className="text-sm font-medium text-delayed">{error}</p>}
      </div>
    </Modal>
  )
}
