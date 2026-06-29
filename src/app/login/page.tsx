'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { Icon, ProductMark } from '@/components/ui/Icon'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const { error: authError } = await createBrowserClient().auth.signInWithPassword({ email, password })
    if (authError) setError('이메일 또는 비밀번호를 확인해 주세요.')
    else router.push('/projects')
  }

  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(420px,0.9fr)_1.1fr]">
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3"><ProductMark /><div><div className="text-sm font-bold tracking-tight text-ink">WBS Cockpit</div><div className="text-[11px] text-ink-subtle">Project intelligence</div></div></div>
          <div className="mt-12">
            <div className="eyebrow">Welcome back</div>
            <h1 className="mt-2 text-[28px] font-bold tracking-[-0.035em] text-ink">프로젝트의 흐름을<br />한눈에 관리하세요.</h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">계획부터 실적, 지연 위험까지 하나의 작업 공간에서 확인합니다.</p>
          </div>

          <form onSubmit={submit} className="mt-9 space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">이메일</span><input className="app-input" type="email" autoComplete="email" placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} required /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">비밀번호</span><input className="app-input" type="password" autoComplete="current-password" placeholder="비밀번호를 입력하세요" value={password} onChange={event => setPassword(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} required /></label>
            {error && <p id="login-error" role="alert" className="flex items-center gap-2 rounded-xl bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed"><Icon name="alert" className="h-4 w-4" />{error}</p>}
            <button className="btn btn-primary mt-1 w-full">로그인<Icon name="arrow" className="h-4 w-4" /></button>
          </form>
        </div>
      </section>

      <section className="relative hidden overflow-hidden bg-sidebar p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute -bottom-40 left-12 h-[28rem] w-[28rem] rounded-full bg-[#6047e8]/20 blur-3xl" />
        <div className="relative z-10 flex justify-end text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-ink-muted">Plan · Track · Deliver</div>
        <div className="relative z-10 mx-auto w-full max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] text-[#bdc8dc]"><span className="h-1.5 w-1.5 rounded-full bg-[#7e98ff]" />Live project workspace</div>
          <blockquote className="mt-6 text-3xl font-semibold leading-[1.35] tracking-[-0.035em] text-white">“복잡한 프로젝트도<br />다음 행동은 명확해야 합니다.”</blockquote>
          <div className="mt-9 grid grid-cols-3 gap-3">
            <Feature icon="layers" title="통합 WBS" text="구조와 일정을 동시에" />
            <Feature icon="chart" title="실시간 진척" text="계획 대비 실적 분석" />
            <Feature icon="alert" title="리스크 감지" text="지연 작업 우선순위" />
          </div>
        </div>
        <div className="relative z-10 text-xs text-sidebar-ink-subtle">WBS Cockpit · Enterprise workspace</div>
      </section>
    </main>
  )
}

function Feature({ icon, title, text }: { icon: 'layers' | 'chart' | 'alert'; title: string; text: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur"><Icon name={icon} className="h-5 w-5 text-[#8da3ff]" /><div className="mt-4 text-xs font-semibold text-white">{title}</div><div className="mt-1 text-[10px] leading-4 text-sidebar-ink-muted">{text}</div></div>
}
