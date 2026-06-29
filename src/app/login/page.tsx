'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'

export default function Login() {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState('')
  const router = useRouter()
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (DEMO) { router.push('/projects'); return }
    const sb = createBrowserClient()
    const { error } = await sb.auth.signInWithPassword({ email, password: pw })
    if (error) setErr('로그인 실패: ' + error.message)
    else router.push('/projects')
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-canvas to-brand-weak/40 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-base font-bold text-brand-fg shadow-sm">
            W
          </div>
          <h1 className="text-lg font-semibold text-ink">WBS 관리 시스템</h1>
          <p className="mt-1 text-sm text-ink-muted">계정으로 로그인하세요</p>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">이메일</span>
            <input className="app-input" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-muted">비밀번호</span>
            <input className="app-input" type="password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} />
          </label>
          {err && (
            <p className="rounded-lg bg-delayed-weak px-3 py-2 text-sm text-delayed">{err}</p>
          )}
          <button className="btn btn-primary mt-1 w-full">{DEMO ? '데모로 입장' : '로그인'}</button>
          {DEMO && (
            <p className="mt-1 text-center text-xs text-ink-subtle">
              데모 모드 — 아이디/비밀번호 없이 버튼만 누르면 둘러볼 수 있어요
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
