// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExplorerData } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({ ArchiveChatPanel: () => null }))

const fetchMinutesExplorer = vi.fn()
const fetchMinuteFavorites = vi.fn()
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => []),
  fetchMinutesSearch: vi.fn(async () => []),
  fetchMinutesExplorer: (...a: unknown[]) => fetchMinutesExplorer(...(a as [])),
  fetchMinuteFavorites: (...a: unknown[]) => fetchMinuteFavorites(...(a as [])),
  toggleMinuteFavorite: vi.fn(async () => true),
}))

import { MinutesView } from '@/components/minutes/MinutesView'

const serverTree: ExplorerData = {
  folders: [{ id: 'f1', name: '생산계획', parentId: null, sort: 5, createdBy: null }],
  leaves: [{
    id: 'm1', minuteDate: '2026-07-16', teamCode: 'MES', title: '물류공정_260716',
    fileCount: 0, createdBy: null, createdByName: null,
    bodyPreview: '', meetingCategory: null, folderId: 'f1',
  }],
  total: 1, truncated: false,
}

/**
 * 서버 프리페치(initialTree) 경로 검증.
 * 이 최적화의 계약은 두 가지다 — (1) 서버가 트리를 실어 보내면 클라이언트가 재조회하지 않는다,
 * (2) 서버 조회가 실패해 null 이면 기존 클라이언트 폴백이 그대로 산다.
 */
describe('MinutesView initialTree 서버 프리페치', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    fetchMinutesExplorer.mockReset()
    fetchMinutesExplorer.mockImplementation(async () => serverTree)
    fetchMinuteFavorites.mockReset()
    fetchMinuteFavorites.mockResolvedValue([])
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(
    initialView: 'list' | 'calendar' | 'tree',
    initialTree: typeof serverTree | null,
    initialFavorites: string[] | null = [],
  ) {
    await act(async () => root.render(
      <MinutesView initialMinutes={[]} initialTree={initialTree} todayIso="2026-07-17"
        initialView={initialView} projects={[]} currentUserId="u1" role="pmo_admin"
        defaultTeam={null} initialFavorites={initialFavorites} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('트리 뷰로 마운트 + 서버 트리 있음 → 클라이언트 재조회 0회, 즉시 렌더', async () => {
    await mount('tree', serverTree)
    // 예전에는 여기서 마운트 effect 가 서버액션 왕복을 한 번 더 돌았다("화면 뜬 뒤 또 로딩").
    expect(fetchMinutesExplorer).not.toHaveBeenCalled()
    expect(container.textContent).toContain('물류공정')
  })

  it('리스트로 마운트했다 트리로 전환해도 서버 트리를 재사용한다', async () => {
    await mount('list', serverTree)
    await act(async () => buttonByText('min.view.tree').click())
    expect(fetchMinutesExplorer).not.toHaveBeenCalled()
    expect(container.textContent).toContain('물류공정')
  })

  it('서버 트리가 null(조회 실패)이면 기존 클라이언트 폴백이 살아난다', async () => {
    await mount('tree', null)
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('물류공정')
  })

  // 계약 고정: 빈 트리 '객체'와 null 은 결과가 완전히 다르다.
  // minutes RLS 는 `to authenticated`(0021:77)라 세션 없는 서버 조회는 에러가 아니라 200+[] 로
  // 돌아오고, getMinutesExplorer 는 그걸 null 이 아닌 빈 트리 객체로 반환한다. 그 객체를 그대로
  // 넘기면 아래처럼 '회의록 없음'으로 위장되고 클라이언트 self-heal 도 막힌다 —
  // 그래서 minutes/page.tsx 가 `initialTree={user ? tree : null}` 로 세션 게이트를 건다.
  it('빈 트리 객체를 넘기면 재조회 없이 "없음"으로 굳는다 — 페이지의 세션 게이트가 필요한 이유', async () => {
    await mount('tree', { folders: [], leaves: [], total: 0, truncated: false })
    expect(fetchMinutesExplorer).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('물류공정')
  })

  it('initialTree 미전달(기본값)도 기존 동작을 유지한다 — 하위 호환', async () => {
    await act(async () => root.render(
      <MinutesView initialMinutes={[]} todayIso="2026-07-17" initialView="tree"
        projects={[]} currentUserId="u1" role="pmo_admin" defaultTeam={null} />,
    ))
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(1)
  })

  it('initialFavorites 프리페치 시 즐겨찾기 재조회 0회', async () => {
    await mount('tree', serverTree, ['m1'])
    expect(fetchMinuteFavorites).not.toHaveBeenCalled()
  })

  it('initialFavorites 가 null(실패/미로그인)이면 트리 뷰에서 1회 폴백 조회한다', async () => {
    await mount('tree', serverTree, null)
    expect(fetchMinuteFavorites).toHaveBeenCalledTimes(1)
  })
})
