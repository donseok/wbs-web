// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => (k === 'min.tree.truncated' ? 'TRUNC {n}' : k), locale: 'ko' }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))
const toast = vi.fn()
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: (...a: unknown[]) => toast(...(a as [])) }) }))
// 무거운 자식은 스텁 — 이 테스트는 MinutesView의 배선만 본다
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div data-testid="cal" /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
const chatProps = vi.fn()
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({
  ArchiveChatPanel: (p: Record<string, unknown>) => { chatProps(p); return null },
}))

const treeResult = {
  folders: [{ id: 'f1', name: '생산계획', parentId: null, sort: 5, createdBy: null }],
  leaves: [{
    id: 'm1', minuteDate: '2026-07-16', teamCode: 'MES', title: '물류공정_260716',
    fileCount: 0, createdBy: null, createdByName: null,
    bodyPreview: '', meetingCategory: null, folderId: 'f1',
  }],
  total: 1, truncated: false,
}
const fetchMinutesExplorer = vi.fn(async () => treeResult as typeof treeResult | null)
const toggleMinuteFavorite = vi.fn(async (id: string, on: boolean) => { void id; void on; return true })
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => []),
  fetchMinutesSearch: vi.fn(async () => []),
  fetchMinutesExplorer: (...a: unknown[]) => fetchMinutesExplorer(...(a as [])),
  fetchMinuteFavorites: vi.fn(async () => []),
  toggleMinuteFavorite: (...a: unknown[]) => toggleMinuteFavorite(...(a as [string, boolean])),
}))

import { MinutesView } from '@/components/minutes/MinutesView'

describe('MinutesView 트리 뷰 배선', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); fetchMinutesExplorer.mockClear(); chatProps.mockClear()
    fetchMinutesExplorer.mockImplementation(async () => treeResult)
    queueUiPref.mockClear()
    toast.mockClear()
    toggleMinuteFavorite.mockReset()
    toggleMinuteFavorite.mockImplementation(async () => true)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(initialView: 'list' | 'calendar' | 'tree' = 'list') {
    await act(async () => root.render(
      <MinutesView initialMinutes={[]} todayIso="2026-07-17" initialView={initialView}
        projects={[]} currentUserId="u1" role="pmo_admin" defaultTeam={null} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('트리 탭 클릭 → fetchMinutesExplorer 1회 호출 + 트리 렌더 + 월 라벨이 전체 기간으로', async () => {
    await mount('list')
    expect(fetchMinutesExplorer).not.toHaveBeenCalled()
    await act(async () => buttonByText('min.view.tree').click())
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('물류공정')
    expect(container.textContent).toContain('min.tree.allPeriod')  // 월 라벨 대체
    // 주의: not.toContain('2026-07')로 검사하면 회의체 행의 latestDate('2026-07-16')와 오탐 충돌한다
    const prevBtn = container.querySelector<HTMLButtonElement>('button[aria-label="prev month"]')
    expect(prevBtn?.disabled).toBe(true)                            // 월 네비 비활성
  })

  it('로드 완료 후 리스트로 갔다 트리로 복귀해도 재조회하지 않는다(캐시 재사용)', async () => {
    await mount('list')
    await act(async () => buttonByText('min.view.tree').click())
    await act(async () => buttonByText('min.view.list').click())
    await act(async () => buttonByText('min.view.tree').click())
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(1)
  })

  it('initialView=tree 마운트 시 자동 조회한다', async () => {
    await mount('tree')
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('물류공정')
  })

  it('null 반환 시 에러 카드 + 재시도 버튼, 재시도가 재조회한다', async () => {
    fetchMinutesExplorer.mockImplementationOnce(async () => null)
    await mount('tree')
    expect(container.textContent).toContain('min.tree.error')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('물류공정')
  })

  it('트리 뷰에서 팀 탭 선택은 재조회 없이 클라이언트 프루닝한다', async () => {
    await mount('tree')
    await act(async () => buttonByText('PMO').click())
    expect(fetchMinutesExplorer).toHaveBeenCalledTimes(1)      // 트리 재조회 없음
    // v2는 리프 필터 — MES 리프(m1)가 PMO 필터로 사라지지만 폴더 레일은 항상 전부 표시된다
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()
    expect(container.textContent).toContain('생산계획')
  })

  it('truncated면 {n}에 MINUTES_TREE_LIMIT를 치환한 안내문을 보여준다', async () => {
    fetchMinutesExplorer.mockImplementationOnce(async () => ({ ...treeResult, truncated: true }))
    await mount('tree')
    expect(container.textContent).toContain('TRUNC 1000')
  })

  it('truncated가 아니면 안내문이 없다', async () => {
    await mount('tree')
    expect(container.textContent).not.toContain('TRUNC')
  })

  it('트리 뷰에서는 보관함 챗 범위가 전 기간(from/to null)이다', async () => {
    await mount('tree')
    const last = chatProps.mock.calls.at(-1)![0] as { from: string | null; to: string | null }
    expect(last.from).toBeNull()
    expect(last.to).toBeNull()
  })

  it('리스트 뷰에서는 보관함 챗 범위가 현재 월이다', async () => {
    await mount('list')
    const last = chatProps.mock.calls.at(-1)![0] as { from: string | null; to: string | null }
    expect(last.from).toBe('2026-07-01')
    expect(last.to).toBe('2026-07-31')
  })

  it('탐색기 레이아웃 변경은 queueUiPref로 동기화된다', async () => {
    await mount('tree')
    await act(async () => buttonByText('min.exp.layout.list').click())
    expect(queueUiPref).toHaveBeenCalledWith({ minutesExplorerLayout: 'list' })
  })

  it('레이아웃 선택은 뷰 왕복에도 유지된다', async () => {
    await mount('tree')
    await act(async () => buttonByText('min.exp.layout.list').click())
    await act(async () => buttonByText('min.view.list').click())
    await act(async () => buttonByText('min.view.tree').click())
    // 탐색기가 언마운트·재마운트돼도 여전히 리스트 모드여야 한다(레이아웃 상태는 MinutesView 소유)
    expect(container.querySelector('article')).toBeNull()
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
  })

  it('별 토글: 성공 경로는 즉시 낙관적으로 반영되고 서버 액션이 호출된다', async () => {
    await mount('tree')
    const stars = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
    const m1star = stars.find(b => b.closest('article')?.textContent?.includes('물류공정_260716'))!
    expect(m1star.getAttribute('aria-pressed')).toBe('false')   // 폴백 즐겨찾기는 빈 Set
    await act(async () => m1star.click())
    expect(m1star.getAttribute('aria-pressed')).toBe('true')
    expect(toggleMinuteFavorite).toHaveBeenCalledWith('m1', true)
  })

  it('별 토글: 실패하면 해당 id만 원복되고 토스트가 뜬다', async () => {
    toggleMinuteFavorite.mockResolvedValueOnce(false)
    await mount('tree')
    const stars = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
    const m1star = stars.find(b => b.closest('article')?.textContent?.includes('물류공정_260716'))!
    await act(async () => m1star.click())
    expect(m1star.getAttribute('aria-pressed')).toBe('false')
    expect(toast).toHaveBeenCalled()
  })
})
