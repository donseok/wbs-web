// @vitest-environment jsdom
// tests/ui/header-chrome-inbox.test.tsx — 벨 배지 합산(개인 unseen + 파생 안읽음 + 공지 안읽음)과
// 벨 열람 = seen 소등(항목 읽음과는 별개) 를 검증한다. 렌더 분기는 inbox-panel.test.tsx가 맡는다.
// 데이터는 ShellStateProvider 가 /api/shell GET 1왕복으로 채운다(2026-08-18 성능 리팩터) —
// 조회는 fetch 스텁으로, 뮤테이션(markInbox*)은 종전처럼 액션 목으로 검증한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/p/p1/dashboard',
  markInboxSeen: vi.fn(async () => ({ ok: true })),
  markAllInboxRead: vi.fn(async () => ({ ok: true })),
  markInboxItemRead: vi.fn(async () => ({ ok: true })),
  markAllNotificationsRead: vi.fn(async () => ({ ok: true })),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    push: mocks.routerPush,
    replace: mocks.routerReplace,
    refresh: mocks.routerRefresh,
  }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'ko',
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}))
vi.mock('@/app/actions/notifications', () => ({
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}))
vi.mock('@/app/actions/inbox', () => ({
  markInboxSeen: mocks.markInboxSeen,
  markAllInboxRead: mocks.markAllInboxRead,
  markInboxItemRead: mocks.markInboxItemRead,
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}))
// 실시간 구독은 향상 계층 — 테스트 대상 아님(supabase 채널 배선을 피한다).
vi.mock('@/lib/hooks/useInboxRealtime', () => ({ useInboxRealtime: () => {} }))
vi.mock('@/components/app/HeaderAnnouncementTicker', () => ({
  HeaderAnnouncementTicker: () => null,
}))
vi.mock('@/components/account/ChangePasswordModal', () => ({
  ChangePasswordModal: () => null,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: vi.fn(),
}))

import { HeaderChrome } from '@/components/app/HeaderChrome'
import { ProjectNavigationProvider } from '@/components/app/ProjectNavigationContext'
import { ShellStateProvider } from '@/components/app/ShellStateProvider'

const projects = [{ id: 'p1', name: 'D-CUBE 프로젝트', status: 'active' as const }]

/** 종전 액션 목과 동일한 데이터 — 개인 1건(unseen)+파생 1건(안읽음)+공지 2건. */
function shellPayload() {
  return {
    inbox: {
      items: [{
        recipientId: 'r1', type: 'issue.assigned', category: 'issue', title: '이슈 A',
        detail: null, href: '/p/p1/issues', createdAt: '2026-08-11', seen: false, read: false,
      }],
      unseen: 1,
    },
    notifications: {
      items: [{ id: 'n1', type: 'delayed' as const, severity: 'danger' as const, title: '지연 항목', detail: 'd', read: false }],
      count: 1,
    },
    unreadAnnouncements: 2,
    headerAnnouncements: [],
  }
}

describe('HeaderChrome 벨 통합', () => {
  let container: HTMLDivElement
  let root: Root
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.pathname = '/p/p1/dashboard'
    mocks.markInboxSeen.mockClear()
    mocks.markAllInboxRead.mockClear()
    mocks.markInboxItemRead.mockClear()
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => shellPayload() }))
    vi.stubGlobal('fetch', fetchMock)
    root = undefined as unknown as Root
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function tree() {
    return (
      <ProjectNavigationProvider
        projects={projects}
        initialLastProjectId="p1"
        initialLastProjectHref="/p/p1/dashboard"
      >
        <ShellStateProvider>
          <HeaderChrome identity={null} projects={projects} />
        </ShellStateProvider>
      </ProjectNavigationProvider>
    )
  }

  async function renderHeader() {
    await act(async () => root.render(tree()))
    // 셸 조회는 마운트 후 비동기로 진행 — flush
    await act(async () => {})
  }

  it('배지는 개인 unseen + 파생 안읽음 + 공지 안읽음을 합산한다(1+1+2=4)', async () => {
    await renderHeader()
    const bellButton = container.querySelector<HTMLButtonElement>('button[aria-label="chrome.notifications"]')
    expect(bellButton).not.toBeNull()
    expect(bellButton!.textContent).toContain('4')
  })

  it('벨을 열면 seen 소등이 낙관 반영되고 markInboxSeen이 호출된다(항목 read는 유지)', async () => {
    await renderHeader()
    const bellButton = container.querySelector<HTMLButtonElement>('button[aria-label="chrome.notifications"]')!
    await act(async () => { bellButton.click() })

    expect(mocks.markInboxSeen).toHaveBeenCalledTimes(1)
    // seen 소등으로 unseenInbox가 0이 되어 배지는 1(파생)+2(공지)=3으로 감소
    expect(bellButton.textContent).toContain('3')
    // 패널에는 여전히 미읍음 항목으로 표시(읽음 처리 아님 — inbox.personal 구획에 노출)
    expect(container.textContent).toContain('이슈 A')
  })

  it('markInboxSeen 실패({ok:false})면 seen 낙관 반영을 롤백하고 배지를 복원한다', async () => {
    mocks.markInboxSeen.mockResolvedValueOnce({ ok: false })
    await renderHeader()
    const bellButton = container.querySelector<HTMLButtonElement>('button[aria-label="chrome.notifications"]')!
    // mock이 즉시 resolve 하므로 클릭 한 번의 act 안에서 낙관 반영→실패 응답→롤백까지 모두 flush 된다.
    // 성공 케이스(위 테스트, mockResolvedValue 기본값 ok:true)는 '3'에 머물지만 여기선 '4'로 복원돼야 한다.
    await act(async () => { bellButton.click() })
    expect(mocks.markInboxSeen).toHaveBeenCalledTimes(1)
    expect(bellButton.textContent).toContain('4') // 롤백 — seen 소등 취소, 배지 원복
  })

  it('프로젝트를 벗어나면 로딩 게이트가 리셋되어 패널이 무기한 로딩에 갇히지 않는다', async () => {
    // 첫 셸 조회는 응답을 붙잡아 둔다 — 프로젝트 화면의 로딩 중 상태를 만들기 위해.
    let resolveFirst: () => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {
      resolveFirst = () => resolve({ ok: true, json: async () => shellPayload() })
    }))
    await renderHeader() // pathname: /p/p1/dashboard (beforeEach 기본값)

    const bellButton = container.querySelector<HTMLButtonElement>('button[aria-label="chrome.notifications"]')!
    await act(async () => { bellButton.click() })
    // 셸 응답이 아직 없어 inboxLoading·notifLoading이 true — 패널은 로딩 표시
    expect(container.textContent).toContain('…')

    // 응답이 오기 전에 프로젝트 페이지를 벗어난다(routeProjectId: 'p1' → null).
    // 두 번째 셸 조회는 기본 스텁이 즉시 응답한다.
    mocks.pathname = '/projects'
    await act(async () => root.render(tree()))
    await act(async () => {})

    // pathname 변경으로 팝오버가 자동 닫힌다 — 다시 열어서 로딩 게이트 상태를 확인
    const bellButton2 = container.querySelector<HTMLButtonElement>('button[aria-label="chrome.notifications"]')!
    await act(async () => { bellButton2.click() })
    expect(container.textContent).not.toContain('…')

    // 늦게 도착한 첫 응답 — 시퀀스 가드에 걸려 상태에 반영되지 않아야 정상
    await act(async () => { resolveFirst() })
    expect(container.textContent).not.toContain('…')
    expect(container.textContent).not.toContain('지연 항목') // 파생 알림이 전역 화면에 되살아나지 않는다
  })
})
