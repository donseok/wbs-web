// @vitest-environment jsdom
// 초대 수령 카드의 분기 계약. 핵심은 **이메일 대조를 클라이언트가 하지 않는다**는 것 —
// 마스킹은 앞 2자와 길이만 남아 다른 주소끼리 충돌하므로(사내 '이름.이니셜@' 관례),
// 판정은 서버(getInviteSessionState·redeemInvite)만 한다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvitePreview } from '@/app/actions/inviteRedeem'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getInviteSessionState: vi.fn(),
  redeemInvite: vi.fn(),
  redeemInviteWithSignup: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}))
vi.mock('@/app/actions/inviteRedeem', () => ({
  getInviteSessionState: mocks.getInviteSessionState,
  redeemInvite: mocks.redeemInvite,
  redeemInviteWithSignup: mocks.redeemInviteWithSignup,
}))

import { InviteRedeemCard } from '@/components/invite/InviteRedeemCard'

const TOKEN = '11111111-2222-4333-8444-555555555555'
const E_OTHER_ACCOUNT = '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.'

/** 초대는 hong.gd@dongkuk.com 앞으로 나갔고, 마스킹은 'ho****@dongkuk.com' 이다. */
const PREVIEW: InvitePreview = {
  projectName: 'D-CUBE',
  projectDescription: null,
  maskedEmail: 'ho****@dongkuk.com',
  status: 'active',
  accountExists: false,
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('InviteRedeemCard 세션 분기', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.signOut.mockResolvedValue({ error: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(preview: InvitePreview = PREVIEW) {
    await act(async () => root.render(
      <InviteRedeemCard token={TOKEN} preview={preview} loadError={null} />,
    ))
    await act(async () => { await Promise.resolve() })
  }

  it('판정 대기 중에는 폼 대신 로딩만 보여준다', async () => {
    mocks.getInviteSessionState.mockReturnValue(new Promise(() => {}))
    await render()

    expect(container.textContent).toContain('로그인 상태를 확인하는 중입니다')
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('마스킹이 같아도 서버가 불일치라고 하면 합류 버튼을 주지 않는다', async () => {
    // 세션은 hong.gs@dongkuk.com — 마스킹하면 초대와 같은 'ho****@dongkuk.com' 이다.
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: true, emailMatches: false })
    await render()

    expect(container.textContent).toContain('해당 계정으로 로그인해 주세요')
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
  })

  it('마스킹이 달라도 서버가 일치라고 하면 합류 버튼을 준다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: true, emailMatches: true })
    mocks.redeemInvite.mockResolvedValue({ ok: true, projectId: 'p1', alreadyMember: false })
    await render({ ...PREVIEW, maskedEmail: 'na****@dongkuk.com' })

    const button = container.querySelector<HTMLButtonElement>('button')!
    expect(button.textContent).toContain('합류하기')

    await act(async () => button.click())
    expect(mocks.redeemInvite).toHaveBeenCalledWith(TOKEN)
    expect(mocks.push).toHaveBeenCalledWith('/projects')
    // 일치 경로에서는 세션을 건드리지 않는다.
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('판정 실패는 비로그인으로 폴백하지 않고 사유를 그대로 보여준다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    await render({ ...PREVIEW, accountExists: true })

    expect(container.querySelector('[role="alert"]')!.textContent)
      .toBe('초대를 확인할 수 없어 중단했습니다.')
    expect(container.querySelector('form')).toBeNull()
  })

  it('로그인 폼은 이메일+비밀번호 2필드이고 마스킹 힌트를 유지한다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    await render({ ...PREVIEW, accountExists: true })

    expect(container.querySelector('#invite-email')).not.toBeNull()
    expect(container.querySelector('#invite-password')).not.toBeNull()
    expect(container.textContent).toContain('초대받은 주소: ho****@dongkuk.com')
  })

  it('로그인 후 서버가 E5 를 돌려주면 방금 만든 세션을 되돌린다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    mocks.redeemInvite.mockResolvedValue({ ok: false, error: E_OTHER_ACCOUNT })
    await render({ ...PREVIEW, accountExists: true })

    const emailInput = container.querySelector<HTMLInputElement>('#invite-email')!
    const passwordInput = container.querySelector<HTMLInputElement>('#invite-password')!
    await act(async () => {
      // 마스킹하면 초대와 같아 보이는 다른 주소 — 클라이언트 선검증이 있었다면 통과시켰을 값이다.
      setValue(emailInput, 'hong.gs@dongkuk.com')
      setValue(passwordInput, 'password123')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // 선검증으로 막지 않고 서버까지 간다.
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'hong.gs@dongkuk.com', password: 'password123',
    })
    expect(mocks.redeemInvite).toHaveBeenCalledWith(TOKEN)
    // 초대와 무관한 계정으로 로그인만 되어 있는 상태를 남기지 않는다.
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(container.textContent).toContain('초대받은 계정으로 로그인해 주세요')
  })

  it('로그인 후 합류가 성공하면 세션을 되돌리지 않는다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    mocks.redeemInvite.mockResolvedValue({ ok: true, projectId: 'p1', alreadyMember: false })
    await render({ ...PREVIEW, accountExists: true })

    const emailInput = container.querySelector<HTMLInputElement>('#invite-email')!
    const passwordInput = container.querySelector<HTMLInputElement>('#invite-password')!
    await act(async () => {
      setValue(emailInput, 'hong.gd@dongkuk.com')
      setValue(passwordInput, 'password123')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith('/projects')
  })

  it('비활성 초대에서는 세션을 묻지 않는다', async () => {
    await render({ ...PREVIEW, status: 'expired' })

    expect(mocks.getInviteSessionState).not.toHaveBeenCalled()
    expect(container.textContent).toContain('만료되었거나 유효하지 않은 초대 링크입니다.')
  })
})
