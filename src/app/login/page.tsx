'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Settings, Zap, GitBranch, Target, Lightbulb, ChartColumn, Clock,
  Sparkles, Mail, Lock, Eye, EyeOff, LogIn,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

/* ── 히어로 부유 장식 (원본 좌표·색·애니메이션 그대로) ───────────────── */
const STATS = [
  { box: 84, rounded: 'rounded-3xl', bg: 'bg-white/[0.05]', float: 'login-float-1', num: '29', numCls: 'text-[22px] text-white/85', label: 'tasks', pos: { top: '8%', left: '8%' } },
  { box: 76, rounded: 'rounded-2xl', bg: 'bg-white/[0.04]', float: 'login-float-3', num: '58', numCls: 'text-[20px] text-white/80', label: '%', pos: { top: '18%', right: '10%' } },
  { box: 72, rounded: 'rounded-2xl', bg: 'bg-white/[0.06]', float: 'login-float-2', num: '11', numCls: 'text-[18px] text-white/80', label: 'done', pos: { bottom: '14%', right: '14%' } },
] as const

const ICON_BADGES = [
  { Icon: Settings, box: 44, rounded: 'rounded-2xl', bg: 'bg-white/[0.05]', float: 'login-float-4', size: 'h-5 w-5', color: 'text-white/35', pos: { top: '5%', right: '30%' } },
  { Icon: Zap, box: 42, rounded: 'rounded-2xl', bg: 'bg-white/[0.04]', float: 'login-float-2', size: 'h-4.5 w-4.5', color: 'text-[rgba(251,191,36,0.5)]', pos: { top: '32%', left: '5%' } },
  { Icon: GitBranch, box: 40, rounded: 'rounded-xl', bg: 'bg-white/[0.05]', float: 'login-float-1', size: 'h-4 w-4', color: 'text-white/30', pos: { top: '52%', right: '6%' } },
  { Icon: Target, box: 42, rounded: 'rounded-2xl', bg: 'bg-white/[0.06]', float: 'login-float-3', size: 'h-4.5 w-4.5', color: 'text-[rgba(251,146,60,0.4)]', pos: { bottom: '22%', left: '10%' } },
  { Icon: Lightbulb, box: 40, rounded: 'rounded-2xl', bg: 'bg-white/[0.04]', float: 'login-float-4', size: 'h-4.5 w-4.5', color: 'text-[rgba(251,191,36,0.45)]', pos: { top: '60%', left: '22%' } },
  { Icon: ChartColumn, box: 38, rounded: 'rounded-xl', bg: 'bg-white/[0.05]', float: 'login-float-1', size: 'h-4 w-4', color: 'text-[rgba(45,212,191,0.45)]', pos: { bottom: '8%', left: '32%' } },
  { Icon: Clock, box: 40, rounded: 'rounded-2xl', bg: 'bg-white/[0.04]', float: 'login-float-2', size: 'h-4.5 w-4.5', color: 'text-[rgba(45,212,191,0.4)]', pos: { top: '42%', right: '26%' } },
] as const

const DOTS = [
  { cls: 'h-2 w-2 bg-white/20 login-float-1', pos: { top: '28%', left: '20%' } },
  { cls: 'h-1.5 w-1.5 bg-[rgba(45,212,191,0.3)] login-float-4', pos: { top: '70%', right: '30%' } },
  { cls: 'h-1.5 w-1.5 bg-white/15 login-float-3', pos: { top: '15%', left: '28%' } },
  { cls: 'h-1 w-1 bg-[rgba(251,191,36,0.25)] login-float-2', pos: { bottom: '30%', right: '38%' } },
] as const

const LINES = [
  { cls: 'w-16 via-white/10 login-float-2', pos: { top: '25%', right: '18%', transform: 'rotate(-20deg)' } },
  { cls: 'w-20 via-white/[0.08] login-float-3', pos: { top: '48%', left: '14%', transform: 'rotate(15deg)' } },
  { cls: 'w-14 via-white/[0.06] login-float-1', pos: { bottom: '35%', right: '10%', transform: 'rotate(-10deg)' } },
] as const

const FEATURES = [
  { title: 'WBS', sub: '작업분류체계' },
  { title: 'Gantt', sub: '일정 관리' },
  { title: 'Team', sub: '팀 협업' },
] as const

const inputBase =
  'w-full rounded-[18px] border border-[rgba(49,37,22,0.18)] bg-[#ffffffd6] py-[0.95rem] text-[16px] text-[#17181d] shadow-[inset_0_1px_rgba(255,255,255,0.55)] outline-none transition-[border-color,box-shadow,background,transform] duration-200 placeholder:text-[#7a6f68] focus:-translate-y-px focus:border-[rgba(15,118,110,0.42)] focus:shadow-[0_0_0_4px_rgba(15,118,110,0.12),inset_0_1px_rgba(255,255,255,0.55)]'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await createBrowserClient().auth.signInWithPassword({ email, password })
    if (authError) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      setLoading(false)
    } else {
      router.push('/projects')
    }
  }

  return (
    <div
      className="relative flex min-h-screen text-[#17181d]"
      style={{
        background:
          'radial-gradient(circle at 8% 10%, rgba(15,118,110,0.18), transparent 24%), radial-gradient(circle at 88% 12%, rgba(203,109,55,0.16), transparent 22%), radial-gradient(circle at 72% 86%, rgba(18,61,100,0.1), transparent 28%), linear-gradient(#f8f3ec, #f3ece1 44%, #ece3d6)',
      }}
    >
      {/* 은은한 앰비언트 글로우 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-12rem] top-[-10rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(15,118,110,0.22),transparent_68%)] blur-3xl" />
        <div className="absolute right-[-10rem] top-[2rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(203,109,55,0.18),transparent_72%)] blur-3xl" />
        <div className="absolute bottom-[-12rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(18,61,100,0.12),transparent_72%)] blur-3xl" />
      </div>

      {/* ── 좌측 히어로 (lg 이상) ─────────────────────────────── */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden lg:flex">
        <div className="relative mx-10 flex h-[calc(100vh-5rem)] w-full max-w-xl flex-col items-center justify-center overflow-hidden rounded-[36px] bg-[linear-gradient(135deg,#0f1117_0%,#1a1d2e_100%)] p-12">
          {/* 카드 내부 글로우 */}
          <div className="pointer-events-none absolute right-[-6rem] top-[-7rem] h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.10),transparent_70%)] blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-8rem] left-[12%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,190,120,0.10),transparent_72%)] blur-3xl" />
          <div className="pointer-events-none absolute left-[30%] top-[40%] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(15,118,110,0.12),transparent_70%)] blur-3xl" />

          {/* 부유 장식 레이어 */}
          <div className="pointer-events-none absolute inset-0">
            {STATS.map((s, i) => (
              <div
                key={`stat-${i}`}
                className={`absolute flex flex-col items-center justify-center border border-white/[0.08] backdrop-blur-sm ${s.rounded} ${s.bg} ${s.float}`}
                style={{ width: s.box, height: s.box, ...s.pos }}
              >
                <span className={`font-bold ${s.numCls}`}>{s.num}</span>
                <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">{s.label}</span>
              </div>
            ))}
            {ICON_BADGES.map((b, i) => {
              const Ico = b.Icon
              return (
                <div
                  key={`icon-${i}`}
                  className={`absolute flex items-center justify-center border border-white/[0.08] backdrop-blur-sm ${b.rounded} ${b.bg} ${b.float}`}
                  style={{ width: b.box, height: b.box, ...b.pos }}
                >
                  <Ico className={`${b.size} ${b.color}`} />
                </div>
              )
            })}
            {DOTS.map((d, i) => (
              <div key={`dot-${i}`} className={`absolute rounded-full ${d.cls}`} style={d.pos} />
            ))}
            {LINES.map((l, i) => (
              <div key={`line-${i}`} className={`absolute h-px bg-gradient-to-r from-transparent to-transparent ${l.cls}`} style={l.pos} />
            ))}
          </div>

          {/* 중앙 콘텐츠 */}
          <div className="relative z-10 text-center">
            <div className="relative mx-auto mb-8 w-fit overflow-hidden rounded-[20px]">
              <Image src="/logo.png" alt="DK Flow" width={80} height={80} priority className="block scale-[1.06]" />
            </div>
            <div className="mx-auto inline-flex items-center gap-[0.45rem] whitespace-nowrap rounded-full border border-white/[0.12] bg-white/[0.14] px-[0.85rem] py-[0.45rem] text-[0.78rem] font-semibold text-white/90">
              <Sparkles className="h-3.5 w-3.5 text-[#cb6d37]" />
              Project Management System
            </div>
            <h1 className="mt-6 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold leading-[0.95] tracking-[-0.06em] text-white">일하는 방식이 바뀌다</h1>
            <p className="mx-auto mt-6 max-w-sm text-base leading-7 text-white/[0.88]">
              WBS, 간트 차트, 팀 관리를 하나의 흐름으로.
              <br />
              프로젝트의 시작부터 완료까지 선명하게.
            </p>
            <div className="mx-auto mt-10 grid max-w-xs grid-cols-3 gap-4">
              {FEATURES.map(f => (
                <div key={f.title} className="rounded-[20px] border border-white/[0.12] bg-white/[0.12] p-4 text-center">
                  <p className="text-2xl font-semibold text-white">{f.title}</p>
                  <p className="mt-1 text-[11px] text-white/[0.84]">{f.sub}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="absolute bottom-6 text-xs text-white/[0.84]">© 2026 동국시스템즈. All rights reserved.</div>
        </div>
      </div>

      {/* ── 우측 로그인 폼 ────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* 모바일 헤더 */}
          <div className="mb-10 flex flex-col items-center gap-3 lg:hidden">
            <div className="relative overflow-hidden rounded-[14px]">
              <Image src="/logo.png" alt="DK Flow" width={56} height={56} priority className="block scale-[1.06]" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#17181d]">DK Flow</h1>
              <p className="mt-1 text-sm text-[#7a6f68]">일하는 방식이 바뀌다</p>
            </div>
          </div>

          {/* 데스크톱 헤딩 */}
          <div className="mb-8 hidden lg:block">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[#17181d]">다시 오신 것을 환영합니다</h2>
            <p className="mt-2 text-sm leading-6 text-[#4a4440]">이메일과 비밀번호로 로그인하세요.</p>
          </div>

          {/* 카드 */}
          <div className="relative w-full rounded-[28px] border border-[rgba(49,37,22,0.12)] bg-[linear-gradient(rgba(255,255,255,0.92),rgba(255,247,240,0.85))] p-6 shadow-[0_52px_120px_-52px_#11182761,0_0_0_1px_#ffffff2e_inset] sm:p-8">
            {/* 탭 (로그인 전용) */}
            <div className="mb-6 flex rounded-2xl border border-[rgba(49,37,22,0.18)] bg-[#ffffff94] p-1">
              <div className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#fffaf4] px-4 py-2.5 text-sm font-medium text-[#17181d] shadow-sm">
                <LogIn className="h-4 w-4" />
                로그인
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-[0.6rem] block text-[0.8rem] font-bold text-[#4a4440]">이메일</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a6f68]" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="user@example.com"
                    className={`${inputBase} pl-10 pr-4`}
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    aria-invalid={!!error}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-[0.6rem] block text-[0.8rem] font-bold text-[#4a4440]">비밀번호</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a6f68]" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={`${inputBase} pl-10 pr-11`}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    aria-invalid={!!error}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(previous => !previous)}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#7a6f68] transition hover:text-[#4a4440]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm font-medium text-[#cb4b5f]">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#0f766e_0%,#155e75_48%,#173a63_100%)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_-24px_rgba(15,118,110,0.8)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-20px_rgba(15,118,110,0.9)] disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <LogIn className="h-4 w-4" />
                {loading ? '로그인 중…' : '로그인'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
