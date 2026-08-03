'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, LogIn, ShieldCheck, UserPlus } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import {
  getInviteSessionState, redeemInvite, redeemInviteWithSignup, type InvitePreview,
} from '@/app/actions/inviteRedeem'

const E_INVALID_LINK = '만료되었거나 유효하지 않은 초대 링크입니다.'
// inviteRedeem.ts 의 E5 원문. 액션 모듈은 'use server' 라 async 함수 외에는 export 할 수 없어
// 상수를 공유하지 못한다 — 문자열로 대조하므로 서버 문구를 바꾸면 여기도 함께 바꿀 것.
const E_OTHER_ACCOUNT = '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.'
const E_SESSION_CHECK = '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/** 서버가 내려주는 화면 분기용 세션 상태. 이메일 원문도 마스킹도 여기로 오지 않는다. */
interface SessionState { authed: boolean; emailMatches: boolean }

/**
 * 초대 수령 카드. **세션 판정을 페이지가 아니라 여기서 시작한다**(설계 P8) — /invite 는
 * 미들웨어 밖이라 RSC 에서 세션을 읽으면 만료 토큰 갱신이 쿠키 쓰기로 이어져 500 이 된다.
 * 마운트 후 서버 액션으로 물으면 액션은 쿠키를 쓸 수 있어 갱신이 정상 동작한다.
 *
 * **이메일 대조는 클라이언트에서 하지 않는다.** 마스킹은 앞 2자와 길이만 남기므로
 * `hong.gd@`와 `hong.gs@`가 같은 값이 된다 — 사내 `이름.이니셜@` 관례에서 흔한 충돌이다.
 * 판정은 getInviteSessionState 가 정규화된 원문끼리 하고 결과 불리언만 내려준다.
 *
 * 이 판정은 어떤 폼을 보여줄지 고르는 어포던스일 뿐이다 — 합류 허용 여부는
 * redeemInvite / redeemInviteWithSignup 이 세션과 초대 이메일을 다시 대조해 결정한다.
 */
export function InviteRedeemCard({ token, preview, loadError }: {
  token: string
  preview: InvitePreview | null
  loadError: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [session, setSession] = useState<SessionState | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  // 비활성 초대는 아래에서 안내 문구만 렌더하므로 세션을 물을 이유가 없다.
  const isActive = preview?.status === 'active'

  useEffect(() => {
    if (!isActive) return
    let alive = true
    // 판정 실패를 '비로그인'으로 폴백하지 않는다 — 엉뚱한 폼을 띄우느니 사유를 보여주고 멈춘다.
    getInviteSessionState(token)
      .then((res) => {
        if (!alive) return
        if (res.ok) setSession({ authed: res.authed, emailMatches: res.emailMatches })
        else setSessionError(res.error)
      })
      .catch((e) => {
        console.error('[invite] 세션 상태 확인 실패:', e instanceof Error ? e.message : e)
        if (alive) setSessionError(E_SESSION_CHECK)
      })
    return () => { alive = false }
  }, [token, isActive])

  function run(work: () => Promise<void>) {
    setBusy(true)
    startTransition(async () => {
      try {
        await work()
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      } finally {
        setBusy(false)
      }
    })
  }

  /**
   * 합류 처리 — 성공/실패 모두 화면에 남기고 넘어간다(조용한 실패 금지).
   *
   * `signOutOnMismatch` 는 로그인 폼 경로에서만 켠다. 방금 만든 세션이 초대와 무관한
   * 계정이었다면 되돌려야 한다 — 합류는 실패했는데 로그인만 되어버린 상태를 남기지 않는다.
   */
  async function join(signOutOnMismatch = false) {
    const res = await redeemInvite(token)
    if (!res.ok) {
      if (signOutOnMismatch && res.error === E_OTHER_ACCOUNT) {
        const { error: signOutError } = await createBrowserClient().auth.signOut()
        if (signOutError) console.error('[invite] 불일치 계정 세션 정리 실패:', signOutError.message)
      }
      setError(res.error)
      return
    }
    toast({
      title: res.alreadyMember ? '이미 합류한 프로젝트입니다.' : '프로젝트에 합류했습니다.',
      variant: 'success',
    })
    router.push('/projects')
  }

  function submitSignup(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    // 서버 왕복 전에 거른다 — 실패가 확실한 제출로 1회용 초대를 건드리지 않는다.
    if (password !== confirmation) { setError('비밀번호가 일치하지 않습니다.'); return }
    run(async () => {
      const res = await redeemInviteWithSignup(token, { name, password, passwordConfirmation: confirmation })
      if (!res.ok) { setError(res.error); return }
      // 이메일은 서버가 초대 행에서 읽어 돌려준 값이다(클라이언트가 정하지 않는다).
      const { error: signInError } = await createBrowserClient().auth
        .signInWithPassword({ email: res.email, password })
      if (signInError) {
        // 가입·합류는 이미 끝났다. 자동 로그인만 실패한 것이므로 로그인 화면으로 보낸다.
        toast({ title: '가입이 완료됐습니다. 로그인 화면에서 로그인해 주세요.', variant: 'info' })
        router.push('/login')
        return
      }
      toast({ title: '프로젝트에 합류했습니다.', variant: 'success' })
      router.push('/projects')
    })
  }

  function submitLogin(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    // 선검증에서 이메일을 대조하지 않는다 — 클라이언트가 가진 것은 마스킹뿐이라 다른 주소끼리
    // 통과·차단이 뒤바뀐다. 판정은 redeemInvite 가 원문끼리 하고, 불일치면 아래에서 세션을 되돌린다.
    run(async () => {
      const { error: signInError } = await createBrowserClient().auth
        .signInWithPassword({ email: email.trim(), password })
      if (signInError) { setError('이메일 또는 비밀번호가 올바르지 않습니다.'); return }
      await join(true)
    })
  }

  /* ── 무효 링크 ────────────────────────────────────────────── */
  // loadError 를 E_INVALID_LINK 로 덮지 않고 서버가 준 사유를 그대로 보여준다(에러 처리 3원칙).
  // 조회 실패(E17 '초대를 확인할 수 없어 중단했습니다.')를 '만료됨'으로 위장하면 DB 장애가
  // 곧 '링크가 만료됐다'는 안내가 되어, 멀쩡한 초대를 관리자가 재발급하게 만든다.
  if (!preview || preview.status !== 'active') {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-delayed-weak text-delayed">
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p role="alert" className="text-sm font-semibold text-ink">{loadError ?? E_INVALID_LINK}</p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              초대 링크는 1회용입니다. 필요하면 프로젝트 관리자에게 다시 요청해 주세요.
            </p>
          </div>
        </div>
        <Link href="/login" className="btn btn-ghost mt-5 w-full">로그인 화면으로</Link>
      </div>
    )
  }

  const errorLine = error
    ? <p role="alert" className="text-sm font-medium text-delayed">{error}</p>
    : null

  return (
    <div className="card p-6">
      <p className="eyebrow">초대받은 프로젝트</p>
      <h2 className="mt-2 text-lg font-semibold text-ink">{preview.projectName || '프로젝트'}</h2>
      {preview.projectDescription && (
        <p className="mt-1 text-sm leading-6 text-ink-muted">{preview.projectDescription}</p>
      )}

      <div className="mt-5 space-y-4">
        {sessionError ? (
          /* 판정 실패 — 사유를 그대로 보여주고 폼은 띄우지 않는다(fail-closed) */
          <>
            <p role="alert" className="text-sm font-medium text-delayed">{sessionError}</p>
            <Link href="/login" className="btn btn-ghost w-full">로그인 화면으로</Link>
          </>
        ) : !session ? (
          <p className="text-sm text-ink-subtle">로그인 상태를 확인하는 중입니다…</p>
        ) : session.authed ? (
          session.emailMatches ? (
            /* 로그인 · 이메일 일치(서버 판정) */
            <>
              <p className="text-sm leading-6 text-ink-muted">
                <span className="font-medium text-ink">{preview.maskedEmail}</span> 계정으로 이 프로젝트에 합류합니다.
              </p>
              {errorLine}
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={busy}
                onClick={() => { setError(''); run(() => join()) }}
              >
                <ShieldCheck className="h-4 w-4" />
                {busy ? '처리 중…' : '합류하기'}
              </button>
            </>
          ) : (
            /* 로그인 · 이메일 불일치(서버 판정) */
            <>
              <p role="alert" className="text-sm leading-6 text-ink-muted">
                이 초대는 <span className="font-medium text-ink">{preview.maskedEmail}</span> 님을 위한 것입니다.
                해당 계정으로 로그인해 주세요.
              </p>
              <Link href="/login" className="btn btn-ghost w-full">로그인 화면으로</Link>
            </>
          )
        ) : preview.accountExists ? (
          /* 비로그인 · 계정 있음 — 로그인 후 이어서 합류 */
          <form onSubmit={submitLogin} className="space-y-4">
            {/* 미리보기는 마스킹된 주소만 내려준다(수신자 비노출) — 읽기 전용 1필드로 만들 수 없어
                이메일도 입력받는다. 대신 마스킹 힌트만 보여주고, 일치 판정은 서버(redeemInvite)에
                맡긴다. 불일치면 join(true) 이 방금 만든 세션을 signOut 으로 되돌린다. */}
            <div>
              <label htmlFor="invite-email" className="mb-1.5 block text-xs font-semibold text-ink-muted">이메일</label>
              <input
                id="invite-email"
                type="email"
                autoComplete="email"
                className="app-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <p className="mt-1.5 text-xs text-ink-subtle">초대받은 주소: {preview.maskedEmail}</p>
            </div>
            <div>
              <label htmlFor="invite-password" className="mb-1.5 block text-xs font-semibold text-ink-muted">비밀번호</label>
              <input
                id="invite-password"
                type="password"
                autoComplete="current-password"
                className="app-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {errorLine}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              <LogIn className="h-4 w-4" />
              {busy ? '처리 중…' : '로그인하고 합류하기'}
            </button>
          </form>
        ) : (
          /* 비로그인 · 계정 없음 — 가입 후 합류. 이메일 입력란은 두지 않는다(설계 P1). */
          <form onSubmit={submitSignup} className="space-y-4">
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">이메일</span>
              <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
                {preview.maskedEmail}
              </p>
              <p className="mt-1.5 text-xs text-ink-subtle">초대에 지정된 주소로만 가입할 수 있습니다.</p>
            </div>
            <div>
              <label htmlFor="invite-name" className="mb-1.5 block text-xs font-semibold text-ink-muted">이름</label>
              <input
                id="invite-name"
                type="text"
                autoComplete="name"
                className="app-input"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="invite-new-password" className="mb-1.5 block text-xs font-semibold text-ink-muted">비밀번호</label>
              <input
                id="invite-new-password"
                type="password"
                autoComplete="new-password"
                className="app-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <p className="mt-1.5 text-xs text-ink-subtle">8자 이상</p>
            </div>
            <div>
              <label htmlFor="invite-password-confirm" className="mb-1.5 block text-xs font-semibold text-ink-muted">비밀번호 확인</label>
              <input
                id="invite-password-confirm"
                type="password"
                autoComplete="new-password"
                className="app-input"
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
                required
              />
            </div>
            {errorLine}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              <UserPlus className="h-4 w-4" />
              {busy ? '처리 중…' : '가입하고 합류하기'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
