// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinutesTreeGroup } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => (k === 'min.tree.truncated' ? 'TRUNC {n}' : k), locale: 'ko' }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn() }))
// 무거운 자식은 스텁 — 이 테스트는 MinutesView의 배선만 본다
vi.mock('@/components/minutes/MinutesCalendar', () => ({ MinutesCalendar: () => <div data-testid="cal" /> }))
vi.mock('@/components/minutes/MinuteUploadModal', () => ({ MinuteUploadModal: () => null }))
const chatProps = vi.fn()
vi.mock('@/components/minutes/ArchiveChatPanel', () => ({
  ArchiveChatPanel: (p: Record<string, unknown>) => { chatProps(p); return null },
}))

const treeResult = {
  groups: [{ teamCode: 'MES', count: 1, bodies: [{ name: '물류공정', count: 1, latestDate: '2026-07-16', leaves: [
    { id: 'm1', minuteDate: '2026-07-16', title: '물류공정_260716', fileCount: 0, createdByName: null },
  ] }] }] as MinutesTreeGroup[],
  total: 1, truncated: false,
}
const fetchMinutesTree = vi.fn(async () => treeResult as typeof treeResult | null)
vi.mock('@/app/actions/minutes', () => ({
  fetchMinutesRange: vi.fn(async () => []),
  fetchMinutesSearch: vi.fn(async () => []),
  fetchMinutesTree: (...a: unknown[]) => fetchMinutesTree(...(a as [])),
}))

import { MinutesView } from '@/components/minutes/MinutesView'

describe('MinutesView 트리 뷰 배선', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); fetchMinutesTree.mockClear(); chatProps.mockClear()
    fetchMinutesTree.mockImplementation(async () => treeResult)
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

  it('트리 탭 클릭 → fetchMinutesTree 1회 호출 + 트리 렌더 + 월 라벨이 전체 기간으로', async () => {
    await mount('list')
    expect(fetchMinutesTree).not.toHaveBeenCalled()
    await act(async () => buttonByText('min.view.tree').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)
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
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)
  })

  it('initialView=tree 마운트 시 자동 조회한다', async () => {
    await mount('tree')
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('물류공정')
  })

  it('null 반환 시 에러 카드 + 재시도 버튼, 재시도가 재조회한다', async () => {
    fetchMinutesTree.mockImplementationOnce(async () => null)
    await mount('tree')
    expect(container.textContent).toContain('min.tree.error')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('물류공정')
  })

  it('트리 뷰에서 팀 탭 선택은 재조회 없이 클라이언트 프루닝한다', async () => {
    await mount('tree')
    await act(async () => buttonByText('PMO').click())
    expect(fetchMinutesTree).toHaveBeenCalledTimes(1)      // 트리 재조회 없음
    expect(container.textContent).not.toContain('물류공정') // MES 그룹 숨김
  })

  it('truncated면 {n}에 MINUTES_TREE_LIMIT를 치환한 안내문을 보여준다', async () => {
    fetchMinutesTree.mockImplementationOnce(async () => ({ ...treeResult, truncated: true }))
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
})
