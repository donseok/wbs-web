'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { Icon, ProductMark } from '@/components/ui/Icon'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

export default function Login() {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const { error: authError } = await createBrowserClient().auth.signInWithPassword({ email, password })
    if (authError) setError(t('home.loginError'))
    else router.push('/projects')
  }

  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(420px,0.9fr)_1.1fr]">
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3"><ProductMark /><div><div className="text-sm font-bold tracking-tight text-ink">WBS Cockpit</div><div className="text-[11px] text-ink-subtle">Project intelligence</div></div></div>
          <div className="mt-12">
            <div className="eyebrow">Welcome back</div>
            <h1 className="mt-2 text-[28px] font-bold tracking-[-0.035em] text-ink">{t('home.loginTitle1')}<br />{t('home.loginTitle2')}</h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">{t('home.loginDesc')}</p>
          </div>

          <form onSubmit={submit} className="mt-9 space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('home.loginEmail')}</span><input className="app-input" type="email" autoComplete="email" placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} required /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('home.loginPassword')}</span><div className="relative"><input className="app-input pr-10" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={t('home.phPassword')} value={password} onChange={event => setPassword(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} required /><button type="button" onClick={() => setShowPassword(previous => !previous)} aria-label={t(showPassword ? 'home.hidePassword' : 'home.showPassword')} className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-xl text-ink-subtle transition duration-150 hover:text-ink focus-visible:text-ink"><Icon name={showPassword ? 'eyeOff' : 'eye'} className="h-4 w-4" /></button></div></label>
            {error && <p id="login-error" role="alert" className="flex items-center gap-2 rounded-xl bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed"><Icon name="alert" className="h-4 w-4" />{error}</p>}
            <button className="btn btn-primary mt-1 w-full">{t('home.loginSubmit')}<Icon name="arrow" className="h-4 w-4" /></button>
          </form>
        </div>
      </section>

      <section className="relative hidden overflow-hidden bg-sidebar p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute -bottom-40 left-12 h-[28rem] w-[28rem] rounded-full bg-[#6047e8]/20 blur-3xl" />
        <div className="relative z-10 flex justify-end text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-ink-muted">Plan · Track · Deliver</div>
        <div className="relative z-10 mx-auto w-full max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] text-[#bdc8dc]"><span className="h-1.5 w-1.5 rounded-full bg-[#7e98ff]" />Live project workspace</div>
          <blockquote className="mt-6 text-3xl font-semibold leading-[1.35] tracking-[-0.035em] text-white">“{t('home.quote1')}<br />{t('home.quote2')}”</blockquote>
          <div className="mt-9 grid grid-cols-3 gap-3">
            <Feature icon="layers" titleKey="home.feat1Title" textKey="home.feat1Text" />
            <Feature icon="chart" titleKey="home.feat2Title" textKey="home.feat2Text" />
            <Feature icon="alert" titleKey="home.feat3Title" textKey="home.feat3Text" />
          </div>
        </div>
        <div className="relative z-10 text-xs text-sidebar-ink-subtle">WBS Cockpit · Enterprise workspace</div>
      </section>
    </main>
  )
}

function Feature({ icon, titleKey, textKey }: { icon: 'layers' | 'chart' | 'alert'; titleKey: DictKey; textKey: DictKey }) {
  const { t } = useLocale()
  return <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur"><Icon name={icon} className="h-5 w-5 text-[#8da3ff]" /><div className="mt-4 text-xs font-semibold text-white">{t(titleKey)}</div><div className="mt-1 text-[10px] leading-4 text-sidebar-ink-muted">{t(textKey)}</div></div>
}
